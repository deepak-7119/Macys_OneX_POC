import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import type { TransactionQuery, TransactionResults } from '../platform/contracts/index.ts';
import { buildBobbin } from '../platform/bobbin/server/bobbin.ts';
import { buildMockUpstream } from '../platform/binder/server/adapters/mock/mock-legacy.ts';
import { legacyTransactions } from '../platform/binder/server/transactions/mock.ts';

const route = '/api/apps/transaction-history/queries';
const original: TransactionQuery = {
  mode: 'upc-date',
  criteria: { upc: '000123456789', fromDate: '2026-11-01', toDate: '2026-11-14' },
};

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
  return { bobbin, upstream, upstreamUrl };
}

test('new store query variation uses the existing browser route with an explicit legacy action/store mapping', async (t) => {
  let sourceInput: unknown;
  const { bobbin } = await fixture(t, (upstream) => {
    upstream.addHook('preHandler', async (request) => {
      if (request.url === '/legacy/transactions/query') sourceInput = request.body;
    });
  });
  const initial = await bobbin.inject({ method: 'POST', url: route, payload: original });
  assert.equal(initial.statusCode, 200);
  assert.equal(initial.json<TransactionResults>().items.length, 4);
  assert.deepEqual(
    [...new Set(initial.json<TransactionResults>().items.map((row) => row.store))].sort(),
    ['1001', '1002'],
  );
  for (const store of ['1001', '1002']) {
    const response = await bobbin.inject({
      method: 'POST',
      url: route,
      payload: { ...original, mode: 'upc-store-date', criteria: { ...original.criteria, store } },
    });
    assert.equal(response.statusCode, 200);
    const result = response.json<TransactionResults>();
    assert.equal(result.items.length, 2);
    assert.equal(result.totalMatches, 2);
    assert.equal(result.truncated, false);
    assert.ok(result.items.every((row) => row.store === store && row.division === '71'));
    assert.deepEqual(sourceInput, {
      opt: 'upcwkstr',
      storeNumber: store,
      divNumber: '71',
      upc: '000123456789',
      week: '11/01/2026',
      endingWeek: '11/14/2026',
    });
  }
  const empty = await bobbin.inject({
    method: 'POST',
    url: route,
    payload: {
      ...original,
      mode: 'upc-store-date',
      criteria: { ...original.criteria, store: '9999' },
    },
  });
  assert.equal(empty.statusCode, 200);
  assert.deepEqual(empty.json<TransactionResults>().items, []);
});

test('store variation requires a strict string store and old mode rejects an ignored store override', async (t) => {
  const { bobbin } = await fixture(t);
  const missing = await bobbin.inject({
    method: 'POST',
    url: route,
    payload: { ...original, mode: 'upc-store-date' },
  });
  assert.equal(missing.statusCode, 422);
  assert.ok(missing.json().error.fields.store);
  for (const store of ['', 'A1001', '12345678901', 1001, null]) {
    const response = await bobbin.inject({
      method: 'POST',
      url: route,
      payload: { ...original, mode: 'upc-store-date', criteria: { ...original.criteria, store } },
    });
    assert.equal(response.statusCode, 400);
  }
  const ignoredOverride = await bobbin.inject({
    method: 'POST',
    url: route,
    payload: { ...original, criteria: { ...original.criteria, store: '1001' } },
  });
  assert.equal(ignoredOverride.statusCode, 400);
  assert.equal(ignoredOverride.json().error.code, 'INVALID_REQUEST');
});

test('the adapter rejects a source response that ignores the chosen store', async (t) => {
  const { bobbin } = await fixture(t, (upstream) => {
    upstream.addHook('onRequest', async (request, reply) => {
      if (request.url === '/legacy/transactions/query')
        return reply.send({
          ok: true,
          synthetic: true,
          service: 'mock-upstream',
          rows: [legacyTransactions[1].summary],
        });
    });
  });
  const response = await bobbin.inject({
    method: 'POST',
    url: route,
    payload: {
      ...original,
      mode: 'upc-store-date',
      criteria: { ...original.criteria, store: '1001' },
    },
  });
  assert.equal(response.statusCode, 502);
  assert.equal(response.json().error.code, 'UPSTREAM_INVALID_RESPONSE');
});

test('server-side HTTP upstream binding swap changes source data without changing the browser contract', async (t) => {
  let firstCalls = 0;
  let secondCalls = 0;
  const first = await fixture(t, (upstream) => {
    upstream.addHook('onRequest', async (request) => {
      if (request.url === '/legacy/transactions/query') firstCalls++;
    });
  });
  const replacement = {
    ...legacyTransactions[0].summary,
    transactionNumber: '79998',
    associateNumber: '9000999',
  };
  const second = await fixture(t, (upstream) => {
    upstream.addHook('onRequest', async (request, reply) => {
      if (request.url === '/legacy/transactions/query') {
        secondCalls++;
        return reply.send({
          ok: true,
          synthetic: true,
          service: 'mock-upstream',
          rows: [replacement],
        });
      }
    });
  });
  assert.notEqual(first.upstreamUrl, second.upstreamUrl);
  const browserOrigins = await Promise.all([
    first.bobbin.listen({ host: '127.0.0.1', port: 0 }),
    second.bobbin.listen({ host: '127.0.0.1', port: 0 }),
  ]);
  const results: TransactionResults[] = [];
  for (const origin of browserOrigins) {
    const response = await fetch(origin + route, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(original),
    });
    assert.equal(response.status, 200);
    results.push((await response.json()) as TransactionResults);
  }
  assert.equal(firstCalls, 1);
  assert.equal(secondCalls, 1);
  assert.equal(results[0].items.length, 4);
  assert.equal(results[1].items.length, 1);
  assert.equal(results[1].items[0].number, '79998');
  assert.deepEqual(Object.keys(results[0]).sort(), Object.keys(results[1]).sort());
  assert.deepEqual(
    Object.keys(results[0].items[0]).sort(),
    Object.keys(results[1].items[0]).sort(),
  );
  const arbitraryTarget = await fetch(
    browserOrigins[0] + route + `?target=${encodeURIComponent(second.upstreamUrl)}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(original),
    },
  );
  assert.equal(arbitraryTarget.status, 400);
  assert.equal(firstCalls, 1);
  assert.equal(secondCalls, 1);
});
