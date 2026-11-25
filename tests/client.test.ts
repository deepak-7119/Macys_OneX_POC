import assert from 'node:assert/strict';
import test from 'node:test';
import { api, ApiError, operationPath } from '../platform/spool/src/client.ts';
import { getManifest } from '../platform/spool/src/manifests.ts';

test('operation binding uses reviewed templates and encodes identifiers as data', () => {
  const manifest = getManifest('transaction-history')!;
  assert.equal(operationPath(manifest, 'query'), '/api/apps/transaction-history/queries');
  assert.equal(
    operationPath(manifest, 'receipt', { id: '71/1001?', variant: 'dcr' }),
    '/api/apps/transaction-history/transactions/71%2F1001%3F/receipts/dcr',
  );
  assert.throws(() => operationPath(manifest, 'unknown'));
  assert.throws(() => operationPath(manifest, 'detail'));
});

test('client refuses off-origin and non-API URLs without issuing a request', async (t) => {
  const mock = t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('Must not fetch');
  });
  for (const path of [
    'https://example.invalid/api/x',
    '//example.invalid/api/x',
    '/internal/config',
  ]) {
    await assert.rejects(api(path), /same-origin/);
  }
  assert.equal(mock.mock.callCount(), 0);
});

test('client preserves structured field validation and request correlation', async (t) => {
  t.mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response(
        JSON.stringify({
          error: {
            code: 'INVALID_CRITERIA',
            message: 'Invalid date',
            requestId: 'local-123',
            fields: { fromDate: 'Use a real date' },
          },
        }),
        { status: 422 },
      ),
  );
  await assert.rejects(api('/api/apps/transaction-history/queries'), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 422);
    assert.equal(error.detail.requestId, 'local-123');
    assert.equal(error.detail.fields?.fromDate, 'Use a real date');
    return true;
  });
});

test('malformed error envelopes still produce a safe actionable client error', async (t) => {
  const mock = t.mock.method(
    globalThis,
    'fetch',
    async () => new Response('<html>gateway failure</html>', { status: 502 }),
  );
  await assert.rejects(
    api('/api/runtime/probe'),
    (error) =>
      error instanceof ApiError && error.status === 502 && error.detail.code === 'REQUEST_FAILED',
  );
  mock.mock.mockImplementation(async () => new Response('{}', { status: 502 }));
  await assert.rejects(
    api('/api/runtime/probe'),
    (error) => error instanceof ApiError && error.status === 502,
  );
});
