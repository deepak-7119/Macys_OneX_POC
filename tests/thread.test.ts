import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  BackButton,
  Button,
  ContextBar,
  DataTable,
  Feedback,
  PageHeader,
  QueryForm,
  RequestError,
  ResultsSummary,
  Tabs,
  money,
} from '../platform/thread/src/index';

test('query fields have associated labels, names, required state and a submit button', () => {
  const markup = renderToStaticMarkup(
    React.createElement(QueryForm, {
      fields: [
        { name: 'upc', label: 'Item UPC', type: 'text', required: true },
        { name: 'fromDate', label: 'From date', type: 'date' },
      ],
      values: { upc: '0123456789012', fromDate: '2026-11-01' },
      onChange() {},
      onSubmit() {},
    }),
  );
  assert.match(markup, /<label for="([^"]+)-upc">Item UPC/);
  const input = markup.match(/<input\b[^>]*name="upc"[^>]*>/)?.[0];
  assert.ok(input, 'UPC field is rendered as a named input');
  assert.match(input, /id="[^"]+-upc"/);
  assert.match(input, /required=""/);
  assert.match(markup, /type="date"/);
  assert.match(markup, /type="submit"/);
});

test('empty table presents a status instead of a broken table', () => {
  const markup = renderToStaticMarkup(
    React.createElement(DataTable, {
      rows: [],
      columns: [{ key: 'title', label: 'Document' }],
      emptyMessage: 'No matching documents.',
    }),
  );
  assert.match(markup, /role="status"/);
  assert.match(markup, /No matching documents/);
  assert.doesNotMatch(markup, /<table/);
});

test('table uses native headers and keyboard-operable detail actions', () => {
  const markup = renderToStaticMarkup(
    React.createElement(DataTable<{ id: string; title: string }>, {
      rows: [{ id: 'd1', title: 'Sample guide' }],
      columns: [{ key: 'title', label: 'Document' }],
      onRowClick() {},
      selectedId: 'd1',
    }),
  );
  assert.match(markup, /<th scope="col">Document<\/th>/);
  assert.match(
    markup,
    /<button type="button" class="thread-row-action" aria-current="true">Sample guide/,
  );
  assert.match(markup, /view details/);
});

test('error feedback announces errors and offers retry; ordinary buttons do not submit forms', () => {
  const markup = renderToStaticMarkup(
    React.createElement(Feedback, { kind: 'error', title: 'Could not load', onRetry() {} }),
  );
  assert.match(markup, /role="alert"/);
  assert.match(markup, /Try again/);
  assert.match(renderToStaticMarkup(React.createElement(Button, null, 'Back')), /type="button"/);
});

test('cross-app navigation, context, error and result patterns are reusable Thread components', () => {
  const context = renderToStaticMarkup(
    React.createElement(
      ContextBar,
      { trailing: 'Division 71 · Store 1001' },
      'Synthetic local data',
    ),
  );
  assert.match(context, /thread-context-bar/);
  assert.match(context, /Synthetic local data/);
  assert.match(context, /Division 71 · Store 1001/);

  const back = renderToStaticMarkup(React.createElement(BackButton, null, '← Back to results'));
  assert.match(back, /type="button"/);
  assert.match(back, /thread-back-button/);

  const summary = renderToStaticMarkup(
    React.createElement(ResultsSummary, { start: '2 displayed', end: 'USD' }),
  );
  assert.match(summary, /aria-label="Results summary"/);
  assert.match(summary, /2 displayed/);

  const error = renderToStaticMarkup(
    React.createElement(RequestError, {
      title: 'Could not load',
      message: 'Try again later.',
      code: 'UPSTREAM_FAILURE',
      requestId: 'request-1',
      onRetry() {},
    }),
  );
  assert.match(error, /role="alert"/);
  assert.match(error, /Request ID: <code>request-1<\/code>/);
  assert.match(error, /Try again/);
});

test('tabs expose selected state and only the active tab is in the tab sequence', () => {
  const markup = renderToStaticMarkup(
    React.createElement(Tabs, {
      items: [
        { id: 'a', label: 'Summary' },
        { id: 'b', label: 'History' },
      ],
      active: 'a',
      onChange() {},
    }),
  );
  assert.match(markup, /role="tablist"/);
  assert.match(markup, /aria-selected="true" tabindex="0"/);
  assert.match(markup, /aria-selected="false" tabindex="-1"/);
});

test('tabs expose caller-provided accessible group names and stable panel relationships', () => {
  const markup = renderToStaticMarkup(
    React.createElement(Tabs, {
      idPrefix: 'receipt',
      label: 'Receipt format',
      items: [
        { id: 'dcr', label: 'DCR' },
        { id: 'electronic', label: 'Electronic' },
      ],
      active: 'dcr',
      onChange() {},
    }),
  );
  assert.match(markup, /role="tablist" aria-label="Receipt format"/);
  assert.match(markup, /id="receipt-tab-dcr" aria-controls="receipt-panel-dcr"/);
  assert.match(markup, /id="receipt-tab-electronic" aria-controls="receipt-panel-electronic"/);
});

test('page heading supports programmatic focus without entering the ordinary tab sequence', () => {
  const markup = renderToStaticMarkup(
    React.createElement(PageHeader, { title: 'Training alerts' }),
  );
  assert.match(markup, /<h1 tabindex="-1">Training alerts<\/h1>/);
});

test('money formats decimal strings and does not present invalid or blank input as zero', () => {
  assert.equal(money('12.50'), '$12.50');
  assert.equal(money('-3.25'), '-$3.25');
  assert.equal(money(''), '—');
  assert.equal(money('not-a-price'), '—');
});
