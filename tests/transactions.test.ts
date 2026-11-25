import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import type {
  Receipt,
  TransactionDetail,
  TransactionQuery,
  TransactionResults,
} from '../platform/contracts/index.ts';
import { buildBobbin } from '../platform/bobbin/server/bobbin.ts';
import { buildMockUpstream } from '../platform/binder/server/adapters/mock/mock-legacy.ts';

const queryUrl = '/api/apps/transaction-history/queries';
const detailUrl = '/api/apps/transaction-history/transactions/';
const sample: TransactionQuery = {
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
  return { bobbin, upstream };
}

test('transaction queries traverse HTTP using explicit legacy parameter/date mappings and filter actual fixtures', async (t) => {
  let legacyInput: unknown;
  const { bobbin } = await fixture(t, (upstream) => {
    upstream.addHook('preHandler', async (request) => {
      if (request.url === '/legacy/transactions/query') legacyInput = request.body;
    });
  });
  const response = await bobbin.inject({ method: 'POST', url: queryUrl, payload: sample });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(legacyInput, {
    opt: 'upcwk',
    divNumber: '71',
    upc: '000123456789',
    week: '11/01/2026',
    endingWeek: '11/14/2026',
  });
  const result = response.json<TransactionResults>();
  assert.equal(result.items.length, 4);
  assert.equal(result.totalMatches, 4);
  assert.equal(result.truncated, false);
  assert.deepEqual([...new Set(result.items.map((row) => row.store))].sort(), ['1001', '1002']);
  assert.ok(
    result.items.every(
      (row) =>
        row.division === '71' &&
        row.date >= sample.criteria.fromDate &&
        row.date <= sample.criteria.toDate,
    ),
  );
  assert.ok(result.items.every((row) => /^71-\d{8}-\d+-\d+-\d+$/.test(row.id)));
  assert.deepEqual(
    result.items.map((row) => row.date),
    ['2026-11-12', '2026-11-10', '2026-11-08', '2026-11-01'],
  );

  const narrow = await bobbin.inject({
    method: 'POST',
    url: queryUrl,
    payload: {
      ...sample,
      criteria: { ...sample.criteria, fromDate: '2026-11-10', toDate: '2026-11-10' },
    },
  });
  assert.equal(narrow.statusCode, 200);
  assert.equal(narrow.json<TransactionResults>().items.length, 1);
  assert.equal(narrow.json<TransactionResults>().items[0].store, '1002');

  for (const criteria of [
    { ...sample.criteria, upc: '111111111111' },
    { ...sample.criteria, fromDate: '2026-10-01', toDate: '2026-10-31' },
  ]) {
    const empty = await bobbin.inject({
      method: 'POST',
      url: queryUrl,
      payload: { ...sample, criteria },
    });
    assert.equal(empty.statusCode, 200);
    assert.deepEqual(empty.json<TransactionResults>().items, []);
    assert.equal(empty.json<TransactionResults>().totalMatches, 0);
  }
});

test('query validation rejects impossible dates, reversed ranges, unsupported modes and invalid UPCs', async (t) => {
  const { bobbin } = await fixture(t);
  for (const input of [
    { ...sample, criteria: { ...sample.criteria, fromDate: '2026-02-30' } },
    { ...sample, criteria: { ...sample.criteria, fromDate: '2026-11-14', toDate: '2026-11-01' } },
    { ...sample, mode: 'unregistered-mode' },
  ]) {
    const response = await bobbin.inject({ method: 'POST', url: queryUrl, payload: input });
    assert.equal(response.statusCode, 422);
    assert.equal(response.json().error.code, 'VALIDATION_ERROR');
    assert.ok(Object.keys(response.json().error.fields).length > 0);
    assert.equal(response.json().error.requestId, response.headers['x-request-id']);
  }
  for (const upc of ['', 'not-a-upc', '1234567890123456', 123456789]) {
    const response = await bobbin.inject({
      method: 'POST',
      url: queryUrl,
      payload: { ...sample, criteria: { ...sample.criteria, upc } },
    });
    assert.equal(response.statusCode, 400);
  }
});

test('caller-controlled divisions, targets and unknown query fields are rejected', async (t) => {
  const { bobbin } = await fixture(t);
  for (const payload of [
    { ...sample, division: '72' },
    { ...sample, target: 'https://example.com' },
    { ...sample, criteria: { ...sample.criteria, division: '72' } },
    { ...sample, criteria: { ...sample.criteria, target: '/legacy/arbitrary' } },
    { ...sample, criteria: { ...sample.criteria, surprise: true } },
  ]) {
    assert.equal((await bobbin.inject({ method: 'POST', url: queryUrl, payload })).statusCode, 400);
  }
  assert.equal(
    (await bobbin.inject({ method: 'POST', url: `${queryUrl}?division=72`, payload: sample }))
      .statusCode,
    400,
  );
  assert.equal(
    (await bobbin.inject(`${detailUrl}71-20261112-1001-20-70001?target=http://127.0.0.1:9`))
      .statusCode,
    400,
  );
});

test('a single matching query resolves to consistent detail, history and receipt variants', async (t) => {
  const { bobbin } = await fixture(t);
  const found = await bobbin.inject({
    method: 'POST',
    url: queryUrl,
    payload: { ...sample, criteria: { ...sample.criteria, upc: '000999888777' } },
  });
  const rows = found.json<TransactionResults>().items;
  assert.equal(rows.length, 1);
  const response = await bobbin.inject(`${detailUrl}${rows[0].id}`);
  assert.equal(response.statusCode, 200);
  const detail = response.json<TransactionDetail>();
  assert.equal(detail.id, rows[0].id);
  assert.equal(detail.total, rows[0].total);
  assert.equal(detail.items[0].upc, '000999888777');
  assert.ok(detail.history.length >= 2);
  assert.deepEqual(detail.receiptVariants, ['dcr', 'electronic']);
  for (const variant of detail.receiptVariants) {
    const response = await bobbin.inject(`${detailUrl}${detail.id}/receipts/${variant}`);
    assert.equal(response.statusCode, 200);
    const receipt = response.json<Receipt>();
    assert.equal(receipt.synthetic, true);
    assert.equal(receipt.transactionId, detail.id);
    assert.equal(receipt.variant, variant);
    assert.deepEqual(receipt.items, detail.items);
    assert.equal(receipt.subtotal, detail.subtotal);
    assert.equal(receipt.tax, detail.tax);
    assert.equal(receipt.total, detail.total);
  }
  const invalid = await bobbin.inject(`${detailUrl}${detail.id}/receipts/nonexistent`);
  assert.equal(invalid.statusCode, 404);
  assert.equal(invalid.json().error.code, 'RECEIPT_NOT_FOUND');
});

test('capability and division authorization cover queries, direct detail and every receipt', async (t) => {
  const { bobbin } = await fixture(t);
  const changed = await bobbin.inject({
    method: 'POST',
    url: '/api/session',
    payload: { profile: 'restricted' },
  });
  const cookie = String(changed.headers['set-cookie']).split(';')[0];
  for (const url of [
    `${detailUrl}71-20261112-1001-20-70001`,
    `${detailUrl}71-20261112-1001-20-70001/receipts/dcr`,
  ]) {
    assert.equal((await bobbin.inject({ url, headers: { cookie } })).statusCode, 403);
  }
  assert.equal(
    (await bobbin.inject({ method: 'POST', url: queryUrl, headers: { cookie }, payload: sample }))
      .statusCode,
    403,
  );
  for (const suffix of ['', '/receipts/dcr', '/receipts/electronic']) {
    const denied = await bobbin.inject(`${detailUrl}72-20261112-1001-20-79999${suffix}`);
    assert.equal(denied.statusCode, 403);
    assert.equal(denied.json().error.code, 'DIVISION_FORBIDDEN');
  }
  for (const id of ['not-a-compound-key', '71-20261112-1001-20-99999']) {
    const missing = await bobbin.inject(`${detailUrl}${id}`);
    assert.equal(missing.statusCode, 404);
    assert.equal(missing.json().error.code, 'TRANSACTION_NOT_FOUND');
  }
});

test('a broad query caps at 250 with an explicit limit warning and stable identifiers', async (t) => {
  const { bobbin } = await fixture(t);
  const response = await bobbin.inject({
    method: 'POST',
    url: queryUrl,
    payload: { ...sample, criteria: { ...sample.criteria, upc: '000000000250' } },
  });
  assert.equal(response.statusCode, 200);
  const result = response.json<TransactionResults>();
  assert.equal(result.items.length, 250);
  assert.equal(result.totalMatches, 251);
  assert.equal(result.limit, 250);
  assert.equal(result.truncated, true);
  assert.ok(result.warnings.some((message) => message.includes('250')));
  assert.equal(new Set(result.items.map((item) => item.id)).size, 250);
});

test('independent concurrent queries do not overwrite transaction state', async (t) => {
  const { bobbin } = await fixture(t);
  const initial = await bobbin.inject('/api/bootstrap');
  const cookie = String(initial.headers['set-cookie']).split(';')[0];
  const [first, second] = await Promise.all([
    bobbin.inject({ method: 'POST', url: queryUrl, headers: { cookie }, payload: sample }),
    bobbin.inject({
      method: 'POST',
      url: queryUrl,
      headers: { cookie },
      payload: { ...sample, criteria: { ...sample.criteria, upc: '000999888777' } },
    }),
  ]);
  const a = first.json<TransactionResults>();
  const b = second.json<TransactionResults>();
  assert.equal(a.items.length, 4);
  assert.equal(b.items.length, 1);
  assert.notEqual(a.queryId, b.queryId);
  assert.notEqual(a.items[0].id, b.items[0].id);
  for (const row of [a.items[0], b.items[0]]) {
    const detail = await bobbin.inject({ url: `${detailUrl}${row.id}`, headers: { cookie } });
    assert.equal(detail.statusCode, 200);
    assert.equal(detail.json<TransactionDetail>().id, row.id);
    assert.equal(detail.json<TransactionDetail>().total, row.total);
  }
});

test('domain query dependency failures retain the common correlated gateway envelope', async (t) => {
  const { bobbin } = await fixture(t, (upstream) => {
    upstream.addHook('onRequest', async (request, reply) => {
      if (request.url === '/legacy/transactions/query')
        return reply.code(503).send({ private: 'legacy connection details' });
    });
  });
  const response = await bobbin.inject({ method: 'POST', url: queryUrl, payload: sample });
  assert.equal(response.statusCode, 502);
  assert.equal(response.json().error.code, 'UPSTREAM_FAILURE');
  assert.equal(response.json().error.requestId, response.headers['x-request-id']);
  assert.ok(!response.body.includes('legacy connection details'));
});
