import assert from 'node:assert/strict';
import test from 'node:test';
import type { Session, TransactionQuery } from '../platform/contracts/index.ts';
import { RuntimeError } from '../platform/bobbin/server/errors.ts';
import {
  actualDate,
  createTransactionAdapter,
} from '../platform/binder/server/transactions/adapter.ts';
import type { LegacyTransactionData } from '../platform/binder/server/transactions/legacy-contract.ts';
import { transactionKey } from '../platform/binder/server/transactions/legacy-contract.ts';
import { DEFAULT_UPC, legacyTransactions } from '../platform/binder/server/transactions/mock.ts';

const session: Session = {
  id: 'independent-review',
  displayName: 'Synthetic review associate',
  division: '71',
  store: '1001',
  capabilities: ['transactions:read'],
  synthetic: true,
};
const query: TransactionQuery = {
  mode: 'upc-date',
  criteria: { upc: DEFAULT_UPC, fromDate: '2026-11-01', toDate: '2026-11-14' },
};

function record(): LegacyTransactionData {
  return structuredClone(legacyTransactions[0]);
}
function adapterReturning(value: unknown) {
  return createTransactionAdapter({ call: async () => structuredClone(value) });
}
function invalidUpstream(error: unknown): boolean {
  assert.ok(error instanceof RuntimeError);
  assert.equal(error.statusCode, 502);
  assert.equal(error.code, 'UPSTREAM_INVALID_RESPONSE');
  return true;
}
function moneyCents(value: string): bigint {
  const match = /^(-?)(\d+)\.(\d{2})$/.exec(value);
  assert.ok(match, `Expected an exact decimal amount, received ${value}`);
  return (BigInt(match[2]) * 100n + BigInt(match[3])) * (match[1] ? -1n : 1n);
}

test('calendar validation rejects overflow and nonleap dates within the legacy year bounds', () => {
  for (const value of [
    '2000-01-01',
    '2000-02-29',
    '2024-02-29',
    '2026-04-30',
    '2096-02-29',
    '2099-12-31',
  ]) {
    assert.equal(actualDate(value), true, value);
  }
  for (const value of [
    '1999-12-31',
    '2100-01-01',
    '1900-02-29',
    '2100-02-29',
    '2026-02-29',
    '2026-02-30',
    '2026-04-31',
    '2026-00-01',
    '2026-13-01',
    '2026-11-00',
    '2026-1-01',
    '2026-11-1',
    '2026-11-01T00:00:00Z',
    '11/01/2026',
    '',
  ]) {
    assert.equal(actualDate(value), false, value);
  }
});

test('invalid calendar searches fail before an upstream operation is issued', async () => {
  let calls = 0;
  const adapter = createTransactionAdapter({
    call: async () => {
      calls += 1;
      return { rows: [] };
    },
  });
  for (const [fromDate, toDate] of [
    ['2026-02-29', '2026-03-01'],
    ['2026-04-01', '2026-04-31'],
    ['1999-12-31', '2000-01-01'],
    ['2099-12-31', '2100-01-01'],
    ['2026-11-14', '2026-11-01'],
  ]) {
    await assert.rejects(
      adapter.query(
        session,
        { ...query, criteria: { ...query.criteria, fromDate, toDate } },
        'calendar-review',
      ),
      (error) => {
        assert.ok(error instanceof RuntimeError);
        assert.equal(error.statusCode, 422);
        assert.ok(error.fields?.fromDate || error.fields?.toDate);
        return true;
      },
    );
  }
  assert.equal(calls, 0);
});

test('upstream query data cannot return a different division or malformed record', async () => {
  const crossDivision = record();
  crossDivision.summary.divNum = '72';
  for (const rows of [
    [crossDivision.summary],
    [null],
    [{ ...record().summary, gregDate: '02/29/2026' }],
  ]) {
    await assert.rejects(
      adapterReturning({ rows }).query(session, query, 'query-review'),
      invalidUpstream,
    );
  }
});

test('query record identities must remain retrievable by the detail identifier contract', async () => {
  for (const [key, value] of [
    ['divNum', '071'],
    ['storeNumber', '12345678901'],
    ['registerNumber', '123456'],
    ['transactionNumber', '123456'],
  ]) {
    const data = record();
    Object.assign(data.summary, { [key]: value });
    await assert.rejects(
      adapterReturning({ rows: [data.summary] }).query(session, query, 'identity-width-review'),
      invalidUpstream,
    );
  }
});

test('duplicate legacy rows do not claim that a complete unique result set was truncated', async () => {
  const row = record().summary;
  const result = await adapterReturning({
    rows: Array.from({ length: 251 }, () => structuredClone(row)),
  }).query(session, query, 'duplicate-review');
  assert.equal(result.items.length, 1);
  assert.equal(result.totalMatches, 1);
  assert.equal(result.truncated, false);
  assert.deepEqual(result.warnings, []);
});

test('detail and receipt reject a different record identity even when the URL division is allowed', async () => {
  const id = transactionKey(record().summary);
  for (const change of [
    (data: LegacyTransactionData) => {
      data.summary.transactionNumber = '70002';
    },
    (data: LegacyTransactionData) => {
      data.summary.divNum = '72';
    },
    (data: LegacyTransactionData) => {
      data.summary.storeNumber = '1002';
    },
  ]) {
    const data = record();
    change(data);
    const adapter = adapterReturning({ transactionData: data });
    await assert.rejects(adapter.detail(session, id, 'detail-identity-review'), invalidUpstream);
    await assert.rejects(
      adapter.receipt(session, id, 'dcr', 'receipt-identity-review'),
      invalidUpstream,
    );
  }
});

test('financially inconsistent upstream details never become a detail or receipt', async () => {
  const id = transactionKey(record().summary);
  const changes = [
    (data: LegacyTransactionData) => {
      data.transactionDetails[0].extendedRetail = '0.01';
    },
    (data: LegacyTransactionData) => {
      data.transactionDetails[0].unitRetail = '24.499';
    },
    (data: LegacyTransactionData) => {
      data.transactionDetails[0].unitCount = 1.5;
    },
    (data: LegacyTransactionData) => {
      data.feeTotals.merchandiseAmount = '0.01';
    },
    (data: LegacyTransactionData) => {
      data.feeTotals.taxAmount = '0.01';
    },
    (data: LegacyTransactionData) => {
      data.summary.transTotal = '0.01';
    },
    (data: LegacyTransactionData) => {
      data.transactionDetails = [];
    },
  ];
  for (const change of changes) {
    const data = record();
    change(data);
    const adapter = adapterReturning({ transactionData: data });
    await assert.rejects(adapter.detail(session, id, 'money-review'), invalidUpstream);
    await assert.rejects(
      adapter.receipt(session, id, 'electronic', 'money-review'),
      invalidUpstream,
    );
  }
});

test('all synthetic fixtures conserve exact item, subtotal, tax and receipt amounts including returns', async () => {
  let hasReturn = false;
  for (const data of legacyTransactions) {
    const identity = transactionKey(data.summary);
    const adapter = adapterReturning({ transactionData: data });
    const fixtureSession = { ...session, division: data.summary.divNum };
    const detail = await adapter.detail(fixtureSession, identity, 'fixture-integrity-review');
    let itemTotal = 0n;
    for (const item of detail.items) {
      assert.equal(
        moneyCents(item.unitPrice) * BigInt(item.quantity),
        moneyCents(item.lineTotal),
        identity,
      );
      itemTotal += moneyCents(item.lineTotal);
      hasReturn ||= item.quantity < 0;
    }
    assert.equal(itemTotal, moneyCents(detail.subtotal), identity);
    assert.equal(
      moneyCents(detail.subtotal) + moneyCents(detail.tax),
      moneyCents(detail.total),
      identity,
    );
    for (const variant of detail.receiptVariants) {
      const receipt = await adapter.receipt(
        fixtureSession,
        identity,
        variant,
        'receipt-integrity-review',
      );
      assert.equal(receipt.transactionId, identity);
      assert.equal(receipt.variant, variant);
      assert.equal(receipt.synthetic, true);
      assert.deepEqual(receipt.items, detail.items);
      assert.deepEqual(
        [receipt.subtotal, receipt.tax, receipt.total],
        [detail.subtotal, detail.tax, detail.total],
      );
    }
  }
  assert.equal(hasReturn, true, 'Negative return amounts must be represented and checked');
});
