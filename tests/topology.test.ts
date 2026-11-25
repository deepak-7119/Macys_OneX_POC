import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { FastifyInstance } from 'fastify';
import type { Bootstrap } from '../platform/contracts/index.ts';
import { buildBobbin } from '../platform/bobbin/server/bobbin.ts';
import { createHttpSessionStore } from '../platform/bobbin/server/session-store.ts';
import { buildMockUpstream } from '../platform/binder/server/adapters/mock/mock-legacy.ts';
import { buildApigeeMock } from '../platform/simulation/apigee-mock.ts';
import { buildMfeStorage } from '../platform/simulation/mfe-storage.ts';
import { buildSessionService } from '../platform/simulation/session-service.ts';

const sessionKey = 'topology-test-session-key';

async function listen(app: FastifyInstance): Promise<string> {
  return app.listen({ host: '127.0.0.1', port: 0 });
}

function cookieOf(response: Response): string {
  const cookie = response.headers.get('set-cookie');
  assert.ok(cookie);
  return cookie.split(';')[0];
}

test('one Hub exposes both reviewed MFEs from the storage origin', async (t) => {
  const bobbin = buildBobbin({
    upstreamUrl: 'http://127.0.0.1:1',
    applicationAssetBaseUrl: 'http://127.0.0.1:4310',
    runtimeProfile: 'combined',
    navigationMode: 'embedded',
  });
  t.after(() => bobbin.close());
  const response = await bobbin.inject('/api/bootstrap');
  assert.equal(response.statusCode, 200);
  const bootstrap = response.json<Bootstrap>();
  assert.equal(bootstrap.runtime.profile, 'combined');
  assert.equal(bootstrap.runtime.navigationMode, 'embedded');
  assert.equal(bootstrap.runtime.orchestration, 'single-spa-root-config');
  assert.equal(bootstrap.runtime.hostingMode, 'bobbin-fallback');
  assert.equal(bootstrap.runtime.assetDelivery, 'gcp-storage-simulation');
  assert.deepEqual(bootstrap.apps.map((app) => app.id).sort(), [
    'associate-communications',
    'transaction-history',
  ]);
  for (const manifest of bootstrap.apps) {
    assert.match(manifest.entry, /^http:\/\/127\.0\.0\.1:4310\/modules\/.+\.js$/);
  }
  assert.match(String(response.headers['content-security-policy']), /http:\/\/127\.0\.0\.1:4310/);
});

test('storage simulation publishes only MFE modules and immutable chunks', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'overlock-mfe-storage-'));
  await mkdir(join(root, 'modules'));
  await mkdir(join(root, 'assets'));
  await writeFile(join(root, 'modules', 'transaction-history.js'), 'export const ok = true;');
  await writeFile(join(root, 'assets', 'thread-123.js'), 'export const shared = true;');
  await writeFile(join(root, 'index.html'), '<h1>must not be served</h1>');
  const storage = buildMfeStorage({
    staticRoot: root,
    allowedBrowserOrigin: 'http://127.0.0.1:4300',
  });
  t.after(async () => {
    await storage.close();
    await rm(root, { recursive: true, force: true });
  });

  const module = await storage.inject('/modules/transaction-history.js');
  assert.equal(module.statusCode, 200);
  assert.equal(module.headers['access-control-allow-origin'], 'http://127.0.0.1:4300');
  assert.equal(module.headers['cache-control'], 'no-cache');
  const chunk = await storage.inject('/assets/thread-123.js');
  assert.equal(chunk.statusCode, 200);
  assert.match(String(chunk.headers['cache-control']), /immutable/);
  const shell = await storage.inject('/index.html');
  assert.equal(shell.statusCode, 404);
  assert.equal(shell.json().error.code, 'ASSET_NOT_FOUND');
});

test('one Hub shares session and API policy while its MFEs stay independently published', async (t) => {
  const services: FastifyInstance[] = [];
  t.after(async () => {
    await Promise.allSettled([...services].reverse().map((service) => service.close()));
  });
  const backend = buildMockUpstream();
  services.push(backend);
  const backendUrl = await listen(backend);
  const apigee = buildApigeeMock({ backendUrl });
  services.push(apigee);
  const apigeeUrl = await listen(apigee);
  const sessionService = buildSessionService({
    internalKey: sessionKey,
    threadActor: 'governance',
  });
  services.push(sessionService);
  const sessionUrl = await listen(sessionService);
  const hub = buildBobbin({
    upstreamUrl: apigeeUrl,
    runtimeProfile: 'combined',
    navigationMode: 'embedded',
    applicationAssetBaseUrl: 'http://127.0.0.1:4310',
    sessionStore: createHttpSessionStore(sessionUrl, sessionKey),
  });
  services.push(hub);
  const hubUrl = await listen(hub);

  const bootstrapResponse = await fetch(`${hubUrl}/api/bootstrap`);
  assert.equal(bootstrapResponse.status, 200);
  const cookie = cookieOf(bootstrapResponse);
  const bootstrap = (await bootstrapResponse.json()) as Bootstrap;
  assert.equal(bootstrap.runtime.name, 'OneX Hub');
  assert.equal(bootstrap.apps.length, 2);

  const transactionManifest = await fetch(`${hubUrl}/api/apps/transaction-history/manifest`, {
    headers: { cookie },
  });
  assert.equal(transactionManifest.status, 200);
  assert.match((await transactionManifest.json()).entry, /4310\/modules\/transaction-history\.js/);

  const menu = await fetch(`${hubUrl}/api/binder/v1/apps/associate-communications/menu`, {
    headers: { cookie },
  });
  assert.equal(menu.status, 200);
  assert.equal((await menu.json()).appId, 'associate-communications');

  const probe = await fetch(`${hubUrl}/api/runtime/probe`, { headers: { cookie } });
  assert.equal(probe.status, 200);
  assert.equal((await probe.json()).upstream.operation, 'legacy.ping');

  const restricted = await fetch(`${hubUrl}/api/session`, {
    method: 'POST',
    headers: { cookie, origin: hubUrl, 'content-type': 'application/json' },
    body: JSON.stringify({ profile: 'restricted' }),
  });
  assert.equal(restricted.status, 200);
  assert.deepEqual(
    ((await restricted.json()) as Bootstrap).apps.map((app) => app.id),
    ['associate-communications'],
  );
  const denied = await fetch(`${hubUrl}/api/apps/transaction-history/manifest`, {
    headers: { cookie },
  });
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).error.code, 'FORBIDDEN');
});
