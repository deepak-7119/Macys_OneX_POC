import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { Readable } from 'node:stream';
import { mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { get } from 'node:http';
import { buildBobbin } from '../platform/bobbin/server/bobbin.ts';
import { buildMockUpstream } from '../platform/binder/server/adapters/mock/mock-legacy.ts';
import type { Bootstrap } from '../platform/contracts/index.ts';

async function fixture(
  t: { after: (fn: () => Promise<void>) => unknown },
  configure?: (app: FastifyInstance) => void,
) {
  const upstream = buildMockUpstream();
  configure?.(upstream);
  const upstreamUrl = await upstream.listen({ host: '127.0.0.1', port: 0 });
  const bobbin = buildBobbin({ upstreamUrl });
  t.after(async () => {
    await bobbin.close();
    await upstream.close();
  });
  return { bobbin, upstream };
}

test('Bobbin rejects foreign/malformed host authorities while accepting exact loopback names', async (t) => {
  const { bobbin } = await fixture(t);
  for (const host of [
    'foreign.example',
    'localhost.foreign.example:80',
    '127.0.0.1.foreign.example',
    'localhost@foreign.example',
    'localhost:0',
    'localhost:65536',
    'localhost/',
    '2130706433',
  ]) {
    const response = await bobbin.inject({ url: '/api/bootstrap', headers: { host } });
    assert.equal(response.statusCode, 403, host);
    assert.equal(response.json().error.code, 'HOST_FORBIDDEN');
    assert.equal(response.json().error.requestId, response.headers['x-request-id']);
    assert.equal(response.headers['access-control-allow-origin'], undefined);
  }
  for (const host of ['localhost:80', 'localhost', '127.0.0.1:80', '[::1]:80']) {
    assert.equal(
      (await bobbin.inject({ url: '/api/bootstrap', headers: { host } })).statusCode,
      200,
      host,
    );
  }
});

test('mutating APIs compare origin scheme, exact loopback hostname and effective port', async (t) => {
  const { bobbin } = await fixture(t);
  for (const origin of [
    'https://foreign.example',
    'http://localhost:81',
    'http://127.0.0.1',
    'https://localhost',
    'null',
    'not-an-origin',
    'http://localhost/path',
    'http://localhost, http://foreign.example',
  ]) {
    const response = await bobbin.inject({
      method: 'POST',
      url: '/api/session',
      headers: { host: 'localhost:80', origin },
      payload: { profile: 'restricted' },
    });
    assert.equal(response.statusCode, 403, origin);
    assert.equal(response.json().error.code, 'ORIGIN_FORBIDDEN');
    assert.equal(response.headers['set-cookie'], undefined);
  }
  for (const [host, origin] of [
    ['localhost:80', 'http://localhost'],
    ['127.0.0.1:80', 'http://127.0.0.1:80'],
    ['[::1]:80', 'http://[::1]'],
  ]) {
    const response = await bobbin.inject({
      method: 'POST',
      url: '/api/session',
      headers: { host, origin },
      payload: { profile: 'restricted' },
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(
      response.json<Bootstrap>().apps.map((app) => app.id),
      ['associate-communications'],
    );
    assert.match(String(response.headers['set-cookie']), /HttpOnly; SameSite=Strict/);
  }
});

test('real HTTP requests must use the actual listening port, and matching origin profile changes work', async (t) => {
  const { bobbin } = await fixture(t);
  const base = await bobbin.listen({ host: '127.0.0.1', port: 0 });
  const valid = await fetch(base + '/api/session', {
    method: 'POST',
    headers: { origin: base, 'content-type': 'application/json' },
    body: JSON.stringify({ profile: 'restricted' }),
  });
  assert.equal(valid.status, 200);
  assert.equal(((await valid.json()) as Bootstrap).apps.length, 1);
  // Node fetch normalizes Host; use the native HTTP client to exercise a forged authority.
  const invalid = await new Promise<{ status: number | undefined; body: string }>(
    (resolve, reject) => {
      get(base + '/api/bootstrap', { headers: { host: '127.0.0.1:80' } }, (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          body += chunk;
        });
        response.on('end', () => resolve({ status: response.statusCode, body }));
      }).on('error', reject);
    },
  );
  assert.equal(invalid.status, 403);
  assert.equal(JSON.parse(invalid.body).error.code, 'HOST_FORBIDDEN');
});

test('public assets retain synthetic/security headers without permissive CORS', async (t) => {
  const staticRoot = await mkdtemp(join(tmpdir(), 'overlock-hardening-static-'));
  const index = join(staticRoot, 'index.html');
  await writeFile(index, '<!doctype html><main>local asset</main>');
  const bobbin = buildBobbin({ upstreamUrl: 'http://127.0.0.1:1', staticRoot });
  t.after(async () => {
    await bobbin.close();
    await unlink(index);
    await rmdir(staticRoot);
  });
  const response = await bobbin.inject('/index.html');
  assert.equal(response.statusCode, 200);
  assert.match(String(response.headers['content-type']), /text\/html/);
  assert.equal(response.headers['x-overlock-data-mode'], 'synthetic');
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  assert.equal(response.headers['x-frame-options'], 'DENY');
  assert.match(String(response.headers['content-security-policy']), /connect-src 'self'/);
  assert.equal(response.headers['access-control-allow-origin'], undefined);
  assert.equal(
    (await bobbin.inject({ url: '/index.html', headers: { host: 'rebound.example' } })).statusCode,
    403,
  );
});

test('oversized client payloads return a correlated 413 rather than an internal-error code', async (t) => {
  const { bobbin } = await fixture(t);
  const response = await bobbin.inject({
    method: 'POST',
    url: '/api/session',
    payload: { profile: 'x'.repeat(1024 * 1024 + 10) },
  });
  assert.equal(response.statusCode, 413);
  assert.equal(response.json().error.code, 'PAYLOAD_TOO_LARGE');
  assert.equal(response.json().error.requestId, response.headers['x-request-id']);
  assert.ok(response.body.length < 1000);
});

test('upstream JSON is bounded by declared length and by actual chunked bytes', async (t) => {
  for (const chunked of [false, true]) {
    const { bobbin } = await fixture(t, (upstream) => {
      upstream.addHook('onRequest', async (request, reply) => {
        if (request.url !== '/legacy/ping') return;
        if (!chunked)
          return reply.send({
            ok: true,
            synthetic: true,
            service: 'mock-upstream',
            operation: 'legacy.ping',
            padding: 'x'.repeat(1024 * 1024),
          });
        return reply
          .type('application/json')
          .send(
            Readable.from([
              '{"ok":true,"synthetic":true,"service":"mock-upstream","operation":"legacy.ping","padding":"',
              'x'.repeat(600000),
              'x'.repeat(600000),
              '"}',
            ]),
          );
      });
    });
    const response = await bobbin.inject('/api/runtime/probe');
    assert.equal(response.statusCode, 502);
    assert.equal(response.json().error.code, 'UPSTREAM_INVALID_RESPONSE');
    assert.ok(response.body.length < 1000);
  }
});

test('upstream deadline also bounds a body that stalls after response headers arrive', async (t) => {
  let beganBody = false;
  const { bobbin } = await fixture(t, (upstream) => {
    upstream.addHook('onRequest', async (request, reply) => {
      if (request.url !== '/legacy/ping') return;
      return reply.type('application/json').send(
        Readable.from(
          (async function* () {
            beganBody = true;
            yield '{"ok":true,"synthetic":true,"service":"mock-upstream","operation":"legacy.ping","padding":"';
            await new Promise((resolve) => setTimeout(resolve, 1800));
            yield 'complete"}';
          })(),
        ),
      );
    });
  });
  const response = await bobbin.inject('/api/runtime/probe');
  assert.equal(beganBody, true);
  assert.equal(response.statusCode, 504);
  assert.equal(response.json().error.code, 'UPSTREAM_TIMEOUT');
});

test('synthetic profile sessions have bounded in-memory capacity and evicted cookies reset locally', async (t) => {
  const { bobbin } = await fixture(t);
  const restricted = await bobbin.inject({
    method: 'POST',
    url: '/api/session',
    payload: { profile: 'restricted' },
  });
  const cookie = String(restricted.headers['set-cookie']).split(';')[0];
  const oldId = restricted.json<Bootstrap>().session.id;
  for (let index = 0; index < 260; index++)
    assert.equal((await bobbin.inject('/api/bootstrap')).statusCode, 200);
  const renewed = await bobbin.inject({ url: '/api/bootstrap', headers: { cookie } });
  assert.equal(renewed.statusCode, 200);
  assert.notEqual(renewed.json<Bootstrap>().session.id, oldId);
  assert.equal(renewed.json<Bootstrap>().apps.length, 2);
  assert.ok(renewed.headers['set-cookie']);
});
