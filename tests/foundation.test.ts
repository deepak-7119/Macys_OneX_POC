import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { buildBobbin } from '../platform/bobbin/server/bobbin.ts';
import { buildMockUpstream } from '../platform/binder/server/adapters/mock/mock-legacy.ts';
import type { Bootstrap } from '../platform/contracts/index.ts';
import { mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function fixture(
  t: { after: (fn: () => Promise<void>) => unknown },
  configure?: (upstream: FastifyInstance) => void,
) {
  const upstream = buildMockUpstream();
  configure?.(upstream);
  const upstreamUrl = await upstream.listen({ host: '127.0.0.1', port: 0 });
  const bobbin = buildBobbin({ upstreamUrl });
  t.after(async () => {
    await bobbin.close();
    await upstream.close();
  });
  return { upstream, bobbin };
}

function cookieOf(response: { headers: Record<string, unknown> }): string {
  const cookie = response.headers['set-cookie'];
  assert.equal(typeof cookie, 'string');
  return (cookie as string).split(';')[0];
}

test('builders do not listen on import/build; local health/bootstrap expose synthetic contracts', async (t) => {
  const upstream = buildMockUpstream();
  const bobbin = buildBobbin({ upstreamUrl: 'http://127.0.0.1:1' });
  t.after(async () => {
    await bobbin.close();
    await upstream.close();
  });
  assert.equal(upstream.server.listening, false);
  assert.equal(bobbin.server.listening, false);
  assert.equal((await upstream.inject('/health')).statusCode, 200);
  assert.equal((await bobbin.inject('/health')).statusCode, 200);
  const response = await bobbin.inject('/api/bootstrap');
  assert.equal(response.statusCode, 200);
  const body = response.json<Bootstrap>();
  assert.equal(body.synthetic, true);
  assert.equal(body.session.synthetic, true);
  assert.deepEqual(body.apps.map((app) => app.id).sort(), [
    'associate-communications',
    'transaction-history',
  ]);
  assert.match(String(response.headers['set-cookie']), /HttpOnly; SameSite=Strict/);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  assert.ok(response.headers['x-request-id']);
  assert.match(String(response.headers['content-security-policy']), /connect-src 'self'/);
  assert.deepEqual(body.binder, {
    name: 'Binder',
    mode: 'mock',
    basePath: '/api/binder/v1',
    contractVersion: '1.0',
  });
  assert.ok(
    body.apps.every((app) =>
      Object.values(app.operations).every(
        (path) =>
          path.startsWith(`/api/apps/${app.id}/`) ||
          path.startsWith(`/api/binder/v1/apps/${app.id}/`),
      ),
    ),
  );
});

test('profile selection persists per browser and enforces app capabilities server-side', async (t) => {
  const { bobbin } = await fixture(t);
  const firstBrowser = await bobbin.inject('/api/bootstrap');
  const secondBrowser = await bobbin.inject('/api/bootstrap');
  const firstCookie = cookieOf(firstBrowser);
  const secondCookie = cookieOf(secondBrowser);
  assert.notEqual(firstCookie, secondCookie);
  const change = await bobbin.inject({
    method: 'POST',
    url: '/api/session',
    headers: { cookie: firstCookie },
    payload: { profile: 'restricted' },
  });
  assert.equal(change.statusCode, 200);
  assert.deepEqual(
    change.json<Bootstrap>().apps.map((app) => app.id),
    ['associate-communications'],
  );
  const persisted = await bobbin.inject({
    url: '/api/bootstrap',
    headers: { cookie: firstCookie },
  });
  assert.equal(persisted.json<Bootstrap>().apps.length, 1);
  const unchanged = await bobbin.inject({
    url: '/api/bootstrap',
    headers: { cookie: secondCookie },
  });
  assert.equal(unchanged.json<Bootstrap>().apps.length, 2);
  const denied = await bobbin.inject({
    url: '/api/apps/transaction-history/manifest',
    headers: { cookie: firstCookie },
  });
  assert.equal(denied.statusCode, 403);
  assert.equal(denied.json().error.code, 'FORBIDDEN');
  assert.equal(
    (
      await bobbin.inject({
        url: '/api/apps/associate-communications/manifest',
        headers: { cookie: firstCookie },
      })
    ).statusCode,
    200,
  );
});

test('manifest/profile/target allowlists reject unknown input with correlated errors', async (t) => {
  const { bobbin } = await fixture(t);
  const unknownApp = await bobbin.inject('/api/apps/unregistered/manifest');
  assert.equal(unknownApp.statusCode, 404);
  assert.equal(unknownApp.json().error.code, 'APP_NOT_FOUND');
  for (const payload of [
    { profile: 'administrator' },
    { profile: 'associate', upstreamUrl: 'https://example.com' },
  ]) {
    const response = await bobbin.inject({ method: 'POST', url: '/api/session', payload });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error.requestId, response.headers['x-request-id']);
  }
  const target = await bobbin.inject('/api/runtime/probe?target=https%3A%2F%2Fexample.com');
  assert.equal(target.statusCode, 400);
  const proxy = await bobbin.inject('/api/proxy?url=https%3A%2F%2Fexample.com');
  assert.equal(proxy.statusCode, 404);
  const unregistered = await bobbin.inject('/api/apps/transaction-history/arbitrary-operation');
  assert.equal(unregistered.statusCode, 404);
  assert.throws(() => buildBobbin({ upstreamUrl: 'https://example.com' }), /loopback/);
});

test('runtime probe traverses a separate real HTTP mock upstream', async (t) => {
  let pingRequests = 0;
  const { bobbin } = await fixture(t, (upstream) => {
    upstream.addHook('onRequest', async (request) => {
      if (request.url === '/legacy/ping') pingRequests++;
    });
  });
  const response = await bobbin.inject('/api/runtime/probe');
  assert.equal((await bobbin.inject('/ready')).statusCode, 200);
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().transport, 'http');
  assert.equal(response.json().upstream.operation, 'legacy.ping');
  assert.equal(pingRequests, 1);
});

test('upstream failures and timeouts become normalized gateway errors', async (t) => {
  const { bobbin } = await fixture(t, (upstream) => {
    upstream.addHook('onRequest', async (request, reply) => {
      if (request.url === '/legacy/ping')
        return reply.code(503).send({ internal: 'do not leak upstream internals' });
    });
  });
  const failed = await bobbin.inject('/api/runtime/probe');
  assert.equal(failed.statusCode, 502);
  assert.equal(failed.json().error.code, 'UPSTREAM_FAILURE');
  assert.equal(failed.json().error.requestId, failed.headers['x-request-id']);
  assert.ok(!failed.body.includes('do not leak'));
  const slow = await fixture(t, (upstream) => {
    upstream.addHook('onRequest', async (request) => {
      if (request.url === '/legacy/ping') await new Promise((resolve) => setTimeout(resolve, 1650));
    });
  });
  const timedOut = await slow.bobbin.inject('/api/runtime/probe');
  assert.equal(timedOut.statusCode, 504);
  assert.equal(timedOut.json().error.code, 'UPSTREAM_TIMEOUT');
  await slow.upstream.close();
  const notReady = await slow.bobbin.inject('/ready');
  assert.equal(notReady.statusCode, 503);
  assert.equal(notReady.json().error.code, 'NOT_READY');
});

test('invalid JSON, unexpected shapes and redirects are rejected without leaking upstream data', async (t) => {
  const cases = [
    { kind: 'malformed', code: 'UPSTREAM_INVALID_RESPONSE' },
    { kind: 'shape', code: 'UPSTREAM_INVALID_RESPONSE' },
    { kind: 'redirect', code: 'UPSTREAM_REDIRECT_REJECTED' },
  ];
  for (const example of cases) {
    const { bobbin } = await fixture(t, (upstream) => {
      upstream.addHook('onRequest', async (request, reply) => {
        if (request.url !== '/legacy/ping') return;
        if (example.kind === 'malformed')
          return reply.type('application/json').send('{invalid-json-secret');
        if (example.kind === 'shape')
          return reply.send({ ok: true, unexpected: 'upstream-private-value' });
        return reply.code(302).header('location', 'http://127.0.0.1:9/unapproved-target').send();
      });
    });
    const response = await bobbin.inject('/api/runtime/probe');
    assert.equal(response.statusCode, 502, example.kind);
    assert.equal(response.json().error.code, example.code, example.kind);
    assert.equal(response.json().error.requestId, response.headers['x-request-id']);
    assert.ok(!response.body.includes('secret'));
    assert.ok(!response.body.includes('upstream-private-value'));
    assert.ok(!response.body.includes('unapproved-target'));
  }
});

test('an unavailable HTTP upstream produces a correlated error and not-ready state', async (t) => {
  const { upstream, bobbin } = await fixture(t);
  await upstream.close();
  const response = await bobbin.inject('/api/runtime/probe');
  assert.equal(response.statusCode, 502);
  assert.equal(response.json().error.code, 'UPSTREAM_UNAVAILABLE');
  assert.equal(response.json().error.requestId, response.headers['x-request-id']);
  assert.equal((await bobbin.inject('/ready')).statusCode, 503);
});

test('SPA fallback serves only the hub and registered app roots, not missing APIs/assets/routes', async (t) => {
  const staticRoot = await mkdtemp(join(tmpdir(), 'overlock-foundation-static-'));
  const index = join(staticRoot, 'index.html');
  await writeFile(index, '<!doctype html><main>foundation test shell</main>');
  const bobbin = buildBobbin({ upstreamUrl: 'http://127.0.0.1:1', staticRoot });
  t.after(async () => {
    await bobbin.close();
    await unlink(index);
    await rmdir(staticRoot);
  });
  for (const route of ['/', '/apps/transaction-history', '/apps/associate-communications']) {
    const response = await bobbin.inject(route);
    assert.equal(response.statusCode, 200, route);
    assert.match(String(response.headers['content-type']), /text\/html/);
    assert.ok(response.body.includes('foundation test shell'));
  }
  for (const route of [
    '/api/missing',
    '/assets/missing.js',
    '/apps/unregistered',
    '/apps/transaction-history/missing.js',
  ]) {
    const response = await bobbin.inject(route);
    assert.equal(response.statusCode, 404, route);
    assert.equal(response.json().error.code, 'NOT_FOUND');
    assert.ok(!response.body.includes('foundation test shell'));
  }
});
