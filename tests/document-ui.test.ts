import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Application, {
  DocumentError,
  DocumentMetadata,
  DocumentViewer,
  documentDate,
  documentUiError,
} from '../applications/associate-communications/src/AssociateCommunicationsApp.tsx';
import type { DocumentDetail, Session } from '../platform/contracts/index.ts';
import { manifests } from '../platform/spool/src/manifests.ts';
import { ApiError } from '../platform/spool/src/client.ts';

const document: DocumentDetail = {
  id: 'ac-101',
  title: 'Fixture training alert',
  groups: ['Apparel'],
  validFrom: '2026-11-13',
  validTo: '',
  isNew: true,
  pageCount: 2,
  category: 'training-alerts',
  description: 'Invented training content.',
  pages: [
    { number: 1, url: '/api/apps/associate-communications/documents/ac-101/pages/1' },
    { number: 2, url: '/api/apps/associate-communications/documents/ac-101/pages/2' },
  ],
};

test('communications opens as its own application with context, fixture date and bounded FOB filter', () => {
  const manifest = manifests.find((item) => item.id === 'associate-communications')!;
  const session: Session = {
    id: 'local',
    displayName: 'Synthetic associate',
    division: '71',
    store: '1001',
    capabilities: ['documents:read'],
    synthetic: true,
  };
  const html = renderToStaticMarkup(React.createElement(Application, { manifest, session }));
  assert.match(html, /Associate Communications/);
  assert.match(html, /Nov 14, 2026/);
  assert.match(html, /Division 71/);
  assert.match(html, /Store 1001/);
  assert.match(html, /<label for="[^"]+">FOB<\/label>/);
  assert.match(html, /Beauty/);
  assert.match(html, /<h1 tabindex="-1">Associate Communications<\/h1>/);
  assert.doesNotMatch(html, /class="communications-app" tabindex/);
  assert.doesNotMatch(html, /type="search"|Keyword|Warranties/);
});

test('document metadata handles unbounded eligibility without constructing an invalid date', () => {
  const html = renderToStaticMarkup(React.createElement(DocumentMetadata, { document }));
  assert.match(html, /Nov 13, 2026/);
  assert.match(html, /No end date/);
  assert.match(html, /2 pages/);
  assert.match(html, /Apparel/);
  assert.equal(documentDate('', 'No end date'), 'No end date');
  assert.doesNotMatch(html, /Invalid Date/);
});

test('viewer requests only the selected page, marks loading, and bounds previous navigation', () => {
  const html = renderToStaticMarkup(React.createElement(DocumentViewer, { document }));
  const images = [...html.matchAll(/<img\b[^>]*src="([^"]+)"[^>]*>/g)];
  assert.equal(images.length, 1);
  assert.equal(images[0][1], document.pages[0].url);
  assert.doesNotMatch(html, /src="[^\"]*pages\/2/);
  assert.match(html, /disabled=""[^>]*>← Previous page/);
  assert.match(html, /Next page →/);
  assert.match(html, /Synthetic document page 1 of 2/);
  assert.match(html, /Loading page 1/);
  assert.match(html, /Not a production PDF/);
  assert.match(html, /role="group" aria-label="Document page display"/);
  assert.match(html, /aria-pressed="true">Fit width/);
  assert.match(html, /aria-pressed="false">Actual size/);
  assert.match(html, /role="region" aria-label="Document page viewing area"/);
});

test('single-page viewer disables both page navigation actions', () => {
  const html = renderToStaticMarkup(
    React.createElement(DocumentViewer, {
      document: { ...document, pageCount: 1, pages: [document.pages[0]] },
    }),
  );
  assert.equal([...html.matchAll(/<button\b[^>]*disabled=""/g)].length, 2);
});

test('document error UI announces backend failures and retains the request reference', () => {
  const error = documentUiError(
    new ApiError(403, {
      code: 'FORBIDDEN',
      message: 'This document is unavailable to your local profile.',
      requestId: 'doc-request-1',
    }),
  );
  const html = renderToStaticMarkup(React.createElement(DocumentError, { error, onRetry() {} }));
  assert.match(html, /role="alert"/);
  assert.match(html, /doc-request-1/);
  assert.match(html, /FORBIDDEN/);
  assert.match(html, /Try again/);
});
