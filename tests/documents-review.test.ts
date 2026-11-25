import assert from 'node:assert/strict';
import test from 'node:test';
import type { Session } from '../platform/contracts/index.ts';
import { createDocumentAdapter } from '../platform/binder/server/documents/adapter.ts';
import type {
  LegacyDocumentData,
  SyntheticDocImage,
} from '../platform/binder/server/documents/legacy-contract.ts';
import { legacyDocuments } from '../platform/binder/server/documents/mock.ts';
import { DOCUMENT_FIXTURE_DATE } from '../platform/binder/server/documents/policy.ts';
import { RuntimeError } from '../platform/bobbin/server/errors.ts';
import type { UpstreamTransport } from '../platform/binder/server/adapters/upstream.ts';

const session: Session = {
  id: 'documents-review',
  displayName: 'Synthetic review associate',
  division: '71',
  store: '1001',
  capabilities: ['documents:read'],
  synthetic: true,
};
function document(): LegacyDocumentData {
  return structuredClone(legacyDocuments[0]);
}
function page(): SyntheticDocImage {
  return {
    format: 'synthetic-page-v1',
    documentId: '101',
    pageNumber: 1,
    pageCount: 2,
    title: 'Synthetic document review',
    paragraphs: ['Invented content for the local demonstration.'],
  };
}
function fixture(record: LegacyDocumentData | null = document(), image: unknown = page()) {
  const calls: string[] = [];
  const upstream: UpstreamTransport = {
    async call(operation) {
      calls.push(operation);
      if (operation === 'documents.list')
        return { documentData: record === null ? [] : [structuredClone(record)] };
      if (operation === 'documents.detail') return { documentData: structuredClone(record) };
      if (operation === 'documents.page') return { docImage: structuredClone(image) };
      throw new Error('Unreviewed operation');
    },
  };
  return { adapter: createDocumentAdapter(upstream), calls };
}
function errorCode(status: number, code: string) {
  return (error: unknown): boolean => {
    assert.ok(error instanceof RuntimeError);
    assert.equal(error.statusCode, status);
    assert.equal(error.code, code);
    return true;
  };
}
const invalid = errorCode(502, 'UPSTREAM_INVALID_RESPONSE');

test('document eligibility includes both date boundaries and preserves a null end date', async () => {
  const sameDay = document();
  sameDay.effectiveDate = DOCUMENT_FIXTURE_DATE;
  sameDay.endDate = DOCUMENT_FIXTURE_DATE;
  const bounded = fixture(sameDay).adapter;
  assert.equal((await bounded.list(session, undefined, 'date-review')).items.length, 1);
  assert.equal(
    (await bounded.detail(session, 'ac-101', 'date-review')).validTo,
    DOCUMENT_FIXTURE_DATE,
  );
  assert.match(await bounded.page(session, 'ac-101', 1, 'date-review'), /SYNTHETIC TRAINING ALERT/);

  sameDay.endDate = null;
  const openEnded = fixture(sameDay).adapter;
  assert.equal((await openEnded.detail(session, 'ac-101', 'date-review')).validTo, '');
});

test('all-store 9999 eligibility works independently of the requested store', async () => {
  const allStores = document();
  allStores.storeArray = ['9999'];
  const { adapter } = fixture(allStores);
  for (const store of ['1001', '1002', '9000']) {
    const otherStore = { ...session, store };
    assert.equal((await adapter.list(otherStore, undefined, 'store-review')).items.length, 1);
    assert.equal((await adapter.detail(otherStore, 'ac-101', 'store-review')).id, 'ac-101');
    assert.match(await adapter.page(otherStore, 'ac-101', 1, 'store-review'), /<svg /);
  }
});

test('metadata and direct page requests independently enforce current document eligibility', async () => {
  for (const changes of [
    { divisionNbr: '72' },
    { storeArray: ['1002'] },
    { storeArray: [] },
    { docType: 2 },
    { effectiveDate: '2026-11-15' },
    { endDate: '2026-11-13' },
  ]) {
    const record = Object.assign(document(), changes);
    const { adapter, calls } = fixture(record);
    assert.equal((await adapter.list(session, undefined, 'eligibility-review')).items.length, 0);
    await assert.rejects(
      adapter.detail(session, 'ac-101', 'eligibility-review'),
      errorCode(403, 'DOCUMENT_FORBIDDEN'),
    );
    await assert.rejects(
      adapter.page(session, 'ac-101', 1, 'eligibility-review'),
      errorCode(403, 'DOCUMENT_FORBIDDEN'),
    );
    assert.ok(
      !calls.includes('documents.page'),
      'An ineligible document must not fetch page content',
    );
  }
});

test('merged multi-FOB membership remains visible under either exact FOB filter', async () => {
  const record = document();
  record.fobArray = ['Apparel', 'Home'];
  const { adapter } = fixture(record);
  for (const group of ['Apparel', 'Home']) {
    const result = await adapter.list(session, group, 'fob-review');
    assert.equal(result.items.length, 1);
    assert.deepEqual(result.items[0].groups, ['Apparel', 'Home']);
  }
  assert.equal(
    (await adapter.list(session, 'Holiday', 'fob-review')).items.length,
    0,
    'A title fragment must not behave as a keyword search',
  );
});

test('new-document flag covers the two-day boundary without including older content', async () => {
  for (const [effectiveDate, expected] of [
    ['2026-11-14', true],
    ['2026-11-12', true],
    ['2026-11-11', false],
  ] as const) {
    const record = document();
    record.effectiveDate = effectiveDate;
    assert.equal(
      (await fixture(record).adapter.detail(session, 'ac-101', 'new-review')).isNew,
      expected,
    );
  }
});

test('malformed calendar metadata cannot change eligibility through timestamp normalization', async () => {
  for (const changes of [
    { effectiveDate: '2026-02-29' },
    { endDate: '2026-04-31' },
    { effectiveDate: '2026-11-14T24:00:00Z' },
    { endDate: '2026-11-14T24:00:00Z' },
    { effectiveDate: '2026-11-14', endDate: '2026-11-13' },
  ]) {
    const { adapter } = fixture(Object.assign(document(), changes));
    await assert.rejects(adapter.list(session, undefined, 'invalid-date-review'), invalid);
    await assert.rejects(adapter.detail(session, 'ac-101', 'invalid-date-review'), invalid);
  }
});

test('unknown page numbers cannot request content and missing records remain distinct from service failure', async () => {
  const { adapter, calls } = fixture();
  for (const number of [-1, 0, 1.5, 3, Number.NaN, Number.POSITIVE_INFINITY]) {
    await assert.rejects(
      adapter.page(session, 'ac-101', number, 'page-review'),
      errorCode(404, 'PAGE_NOT_FOUND'),
    );
  }
  assert.ok(!calls.includes('documents.page'));
  assert.deepEqual(
    (await fixture(null).adapter.list(session, undefined, 'empty-review')).items,
    [],
  );
  await assert.rejects(
    fixture(null).adapter.detail(session, 'ac-101', 'missing-review'),
    errorCode(404, 'DOCUMENT_NOT_FOUND'),
  );
  await assert.rejects(
    fixture(document(), null).adapter.page(session, 'ac-101', 1, 'missing-review'),
    errorCode(404, 'PAGE_NOT_FOUND'),
  );

  const failed = createDocumentAdapter({
    call: async () => {
      throw new RuntimeError(502, 'UPSTREAM_FAILURE', 'Synthetic dependency failure.');
    },
  });
  await assert.rejects(
    failed.list(session, undefined, 'failure-review'),
    errorCode(502, 'UPSTREAM_FAILURE'),
  );
  await assert.rejects(
    failed.page(session, 'ac-101', 1, 'failure-review'),
    errorCode(502, 'UPSTREAM_FAILURE'),
  );
});

test('page envelopes bind document identity, page number and count and reject executable formats', async () => {
  for (const image of [
    { ...page(), documentId: '102' },
    { ...page(), pageNumber: 2 },
    { ...page(), pageCount: 3 },
    { ...page(), format: 'image/svg+xml' },
    { ...page(), svg: '<svg onload="alert(1)"/>' },
    { ...page(), url: 'https://example.invalid/document.svg' },
    { ...page(), paragraphs: ['bad\u0000text'] },
    { ...page(), paragraphs: [] },
    { svg: '<svg><script>alert(1)</script></svg>' },
  ]) {
    await assert.rejects(
      fixture(document(), image).adapter.page(session, 'ac-101', 1, 'image-review'),
      invalid,
    );
  }
});

test('upstream markup stays escaped text inside an explicitly synthetic server-generated page', async () => {
  const record = document();
  record.documentName = 'Synthetic "document" & <title>';
  const image = page();
  image.title = 'Synthetic "page" & <title>';
  image.paragraphs = [
    '<script>alert(1)</script>',
    '<foreignObject/>',
    '<image href="https://example.invalid/a"/>',
    '<text onload="alert(1)">text</text>',
  ];
  const svg = await fixture(record, image).adapter.page(session, 'ac-101', 1, 'escaping-review');
  assert.match(svg, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(svg, /&lt;foreignObject\/&gt;/);
  assert.match(svg, /&quot;document&quot; &amp; &lt;title&gt;/);
  assert.doesNotMatch(svg, /<(?:script|foreignObject|image|use|a)\b/i);
  assert.doesNotMatch(svg, /\s(?:onload|onclick|href|xlink:href)\s*=\s*["']/i);
  assert.match(svg, /SYNTHETIC TRAINING ALERT/);
  assert.match(svg, /INVENTED CONTENT/);
  assert.match(svg, /NOT AN OFFICIAL POLICY/);
});
