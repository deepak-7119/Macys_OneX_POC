import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildBobbin } from '../platform/bobbin/server/bobbin.ts';
import { getManifest } from '../platform/spool/src/manifests.ts';

// Deliberately separate from *.test.ts: these checks run only after npm run build.
// Compiled modules are inspected as text, never executed in Node's DOM-free context.
const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const entries = {
  hub: resolve(dist, 'modules/main.js'),
  transactions: resolve(dist, 'modules/transaction-history.js'),
  documents: resolve(dist, 'modules/associate-communications.js'),
};

function staticImports(source: string): string[] {
  return [
    ...source.matchAll(/\bimport\s*(?:[^;"']*?\bfrom\s*)?["']([^"']+)["']/g),
    ...source.matchAll(/\bexport\s*(?:\*|\{[^}]*\})\s*from\s*["']([^"']+)["']/g),
  ].map((match) => match[1]);
}
function exportedNames(source: string): string[] {
  const lists = [...source.matchAll(/\bexport\s*\{([^}]+)\}/g)].flatMap((match) =>
    match[1].split(',').map((specifier) =>
      specifier
        .trim()
        .split(/\s+as\s+/)
        .at(-1)!,
    ),
  );
  const declarations = [
    ...source.matchAll(/\bexport\s+(?:async\s+)?(?:function|const|let|class)\s+(\w+)/g),
  ].map((match) => match[1]);
  return [...new Set([...lists, ...declarations])].sort();
}
async function importGraph(
  entry: string,
  includeLiteralDynamicImports = false,
): Promise<Set<string>> {
  const files = new Set<string>();
  async function visit(file: string): Promise<void> {
    if (files.has(file)) return;
    files.add(file);
    const source = await readFile(file, 'utf8');
    const dynamicImports = includeLiteralDynamicImports
      ? [...source.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)].map((match) => match[1])
      : [];
    for (const specifier of [...staticImports(source), ...dynamicImports]) {
      assert.ok(
        specifier.startsWith('.') || specifier.startsWith('/'),
        `Unexpected external build dependency: ${specifier}`,
      );
      const dependency = specifier.startsWith('/')
        ? resolve(dist, specifier.slice(1))
        : resolve(dirname(file), specifier);
      const withinDist = relative(dist, dependency);
      assert.ok(
        !withinDist.startsWith('..') && !isAbsolute(withinDist),
        'Build imports must remain inside dist',
      );
      assert.equal(
        dependency.endsWith('.js'),
        true,
        `Unexpected emitted module type: ${specifier}`,
      );
      await visit(dependency);
    }
  }
  await visit(entry);
  return files;
}

test('each compiled application entry retains its single-spa lifecycle exports', async () => {
  for (const entry of [entries.transactions, entries.documents]) {
    assert.deepEqual(
      exportedNames(await readFile(entry, 'utf8')),
      ['bootstrap', 'mount', 'unmount'],
      basename(entry),
    );
  }
});

test('the hub cannot eagerly import either app and app entries do not import one another', async () => {
  const [hub, transactions, documents] = await Promise.all([
    importGraph(entries.hub),
    importGraph(entries.transactions, true),
    importGraph(entries.documents, true),
  ]);
  assert.equal(
    hub.has(entries.transactions),
    false,
    'The hub must defer the transaction entry until launch',
  );
  assert.equal(
    hub.has(entries.documents),
    false,
    'The hub must defer the communications entry until launch',
  );
  assert.equal(transactions.has(entries.documents), false, 'TH must load independently of AC');
  assert.equal(documents.has(entries.transactions), false, 'AC must load independently of TH');

  const index = await readFile(resolve(dist, 'index.html'), 'utf8');
  const initialAssets = [
    ...index.matchAll(/<(?:script|link)\b[^>]*(?:src|href)=["']([^"']+)["']/g),
  ].map((match) => match[1]);
  for (const entry of [entries.transactions, entries.documents]) {
    assert.ok(
      !initialAssets.some((asset) => asset.endsWith(`/modules/${basename(entry)}`)),
      `index.html must not preload ${basename(entry)}`,
    );
  }
});

test('both app bundles reference exactly the same shared Thread and React chunks', async () => {
  const [transactions, documents] = await Promise.all([
    importGraph(entries.transactions),
    importGraph(entries.documents),
  ]);
  for (const name of ['thread', 'react-vendor']) {
    const pattern = new RegExp(`^${name}-[A-Za-z0-9_-]+\\.js$`);
    const transactionChunks = [...transactions].filter((file) => pattern.test(basename(file)));
    const documentChunks = [...documents].filter((file) => pattern.test(basename(file)));
    assert.equal(transactionChunks.length, 1, `${name} must be emitted once per dependency graph`);
    assert.deepEqual(
      documentChunks,
      transactionChunks,
      `Both applications must reuse one ${name} implementation`,
    );
  }
});

test('Bobbin serves compiled module bytes with executable JavaScript MIME types', async (t) => {
  const bobbin = buildBobbin({ upstreamUrl: 'http://127.0.0.1:1', staticRoot: dist });
  t.after(() => bobbin.close());
  for (const file of Object.values(entries)) {
    const response = await bobbin.inject(`/modules/${basename(file)}`);
    assert.equal(response.statusCode, 200);
    assert.match(
      String(response.headers['content-type']),
      /^(?:text|application)\/(?:x-)?javascript\b/,
    );
    assert.equal(response.headers['x-content-type-options'], 'nosniff');
    assert.equal(response.body, await readFile(file, 'utf8'));
  }
});

test('the branded logo is bundled and served locally as SVG', async (t) => {
  const bobbin = buildBobbin({ upstreamUrl: 'http://127.0.0.1:1', staticRoot: dist });
  t.after(() => bobbin.close());
  const source = await readFile(resolve(dist, '../public/brand/macys-logo.svg'), 'utf8');
  const response = await bobbin.inject('/brand/macys-logo.svg');
  assert.equal(response.statusCode, 200);
  assert.match(String(response.headers['content-type']), /^image\/svg\+xml\b/);
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  assert.equal(response.body, source);
  assert.equal(await readFile(resolve(dist, 'brand/macys-logo.svg'), 'utf8'), source);
});

test('direct application roots serve the SPA while unknown APIs and assets remain real 404s', async (t) => {
  const bobbin = buildBobbin({ upstreamUrl: 'http://127.0.0.1:1', staticRoot: dist });
  t.after(() => bobbin.close());
  const index = await readFile(resolve(dist, 'index.html'), 'utf8');
  const paths = [
    '/',
    '/?view=pos',
    ...['transaction-history', 'associate-communications'].flatMap((id) => {
      const manifest = getManifest(id);
      assert.ok(manifest);
      return [
        manifest.path,
        `${manifest.path}/`,
        `${manifest.path}?direct=true`,
        `${manifest.path}?view=pos`,
      ];
    }),
  ];
  for (const path of paths) {
    const response = await bobbin.inject(path);
    assert.equal(response.statusCode, 200, path);
    assert.match(String(response.headers['content-type']), /^text\/html\b/);
    assert.equal(response.body, index, path);
  }
  for (const path of [
    '/api/unreviewed-operation',
    '/api/apps/associate-communications/unreviewed-operation',
    '/modules/missing-application.js',
    '/assets/missing-style.css',
    '/unknown-application',
    '/package.json',
    '/server/bobbin.ts',
  ]) {
    const response = await bobbin.inject(path);
    assert.equal(response.statusCode, 404, path);
    assert.match(String(response.headers['content-type']), /^application\/json\b/);
    assert.equal(response.json().error.code, 'NOT_FOUND', path);
    assert.equal(response.json().error.requestId, response.headers['x-request-id']);
    assert.notEqual(response.body, index, path);
  }
});
