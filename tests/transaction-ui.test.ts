import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Application, {
  ReceiptView,
  TransactionError,
  initialQueryValues,
  toTransactionUiError,
} from '../applications/transaction-history/src/TransactionHistoryApp.tsx';
import { ApiError } from '../platform/spool/src/client.ts';
import { manifests } from '../platform/spool/src/manifests.ts';
import type { AppManifest, Receipt, Session } from '../platform/contracts/index.ts';

const session: Session = {
  id: 'ui-fixture',
  displayName: 'Synthetic associate',
  division: '71',
  store: '1001',
  capabilities: ['transactions:read'],
  synthetic: true,
};

test('transaction search renders configured fields, context, and an explicit synthetic notice', () => {
  const base = manifests.find((manifest) => manifest.id === 'transaction-history')!;
  const manifest: AppManifest = {
    ...base,
    searchModes: [
      {
        id: 'configured-mode',
        label: 'Configured search',
        fields: [
          { name: 'upc', label: 'Item UPC', type: 'text', required: true },
          { name: 'store', label: 'Store number', type: 'text' },
        ],
      },
    ],
  };
  const html = renderToStaticMarkup(React.createElement(Application, { manifest, session }));
  assert.match(html, /Configured search/);
  assert.match(html, /name="store"/);
  assert.match(html, /Store number/);
  assert.doesNotMatch(html, /name="fromDate"/);
  assert.match(html, /Division 71/);
  assert.match(html, /Store 1001/);
  assert.match(html, /All transactions are invented/);
  assert.match(html, /Find transactions/);
});

test('query defaults preserve leading-zero UPC and do not invent a store restriction', () => {
  const values = initialQueryValues([
    { name: 'upc', label: 'UPC', type: 'text' },
    { name: 'fromDate', label: 'From', type: 'date' },
    { name: 'toDate', label: 'To', type: 'date' },
    { name: 'store', label: 'Store', type: 'text' },
  ]);
  assert.deepEqual(values, {
    upc: '000123456789',
    fromDate: '2026-11-01',
    toDate: '2026-11-14',
    store: '',
  });
});

test('configured search tabs control existing labelled panels including the hidden inactive mode', () => {
  const manifest = manifests.find((item) => item.id === 'transaction-history')!;
  const html = renderToStaticMarkup(React.createElement(Application, { manifest, session }));
  const controls = [...html.matchAll(/id="([^"]+)" aria-controls="([^"]+)"[^>]*role="tab"/g)];
  assert.ok(controls.length >= 1);
  for (const control of controls) {
    assert.ok(
      html.includes(`id="${control[2]}" role="tabpanel" aria-labelledby="${control[1]}"`),
      'every query tab targets a panel labelled by that tab',
    );
  }
  assert.match(html, /aria-label="Transaction search modes"/);
  assert.match(html, /<h1 tabindex="-1">Transaction History<\/h1>/);
  assert.doesNotMatch(html, /class="transaction-app" tabindex/);
});

test('API validation failures retain field messages and request reference in live error UI', () => {
  const error = toTransactionUiError(
    new ApiError(422, {
      code: 'INVALID_QUERY',
      message: 'Review your search.',
      requestId: 'request-test-1',
      fields: { fromDate: 'Choose a valid date.' },
    }),
  );
  const html = renderToStaticMarkup(
    React.createElement(TransactionError, {
      error,
      fields: [{ name: 'fromDate', label: 'From date', type: 'date' }],
    }),
  );
  assert.match(html, /role="alert"/);
  assert.match(html, /From date: Choose a valid date/);
  assert.match(html, /request-test-1/);
  assert.match(html, /INVALID_QUERY/);
});

test('receipt view displays fetched decimal values and cannot send or charge anything', () => {
  const receipt: Receipt = {
    transactionId: 't1',
    variant: 'dcr',
    title: 'Synthetic store receipt',
    lines: [{ label: 'Store', value: '1001' }],
    items: [
      {
        upc: '000123456789',
        description: 'Fixture item',
        quantity: 2,
        unitPrice: '12.50',
        lineTotal: '25.00',
      },
    ],
    subtotal: '25.00',
    tax: '2.25',
    total: '27.25',
    currency: 'USD',
    synthetic: true,
  };
  const html = renderToStaticMarkup(React.createElement(ReceiptView, { receipt }));
  assert.match(html, /SYNTHETIC RECEIPT/);
  assert.match(html, /\$27\.25/);
  assert.match(html, /000123456789/);
  assert.match(html, /Not proof of purchase/);
  assert.doesNotMatch(html, /<button|<form/);
});
