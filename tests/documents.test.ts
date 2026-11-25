import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import type { DocumentDetail, DocumentResults } from '../platform/contracts/index.ts';
import { buildBobbin } from '../platform/bobbin/server/bobbin.ts';
import { buildMockUpstream } from '../platform/binder/server/adapters/mock/mock-legacy.ts';
import { legacyDocuments } from '../platform/binder/server/documents/mock.ts';

const listUrl = '/api/apps/associate-communications/documents';
const listQuery = `${listUrl}?category=training-alerts`;

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

test('document list uses real HTTP with source-shaped fixed context and filters eligible catalog records', async (t) => {
  let input: unknown;
  const { bobbin } = await fixture(t, (upstream) => {
    upstream.addHook('preHandler', async (request) => {
      if (request.url === '/legacy/documents/list') input = request.body;
    });
  });
  const response = await bobbin.inject(listQuery);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(input, {
    checkEffectiveDate: true,
    divisionNbr: '71',
    docType: 1,
    storeNbr: '1001',
    checkFOB: true,
  });
  const result = response.json<DocumentResults>();
  assert.deepEqual(
    result.items.map((document) => document.id),
    ['ac-101', 'ac-102'],
  );
  assert.equal(result.totalMatches, 2);
  assert.equal(result.limit, 50);
  assert.equal(result.truncated, false);
  assert.deepEqual(result.items[0].groups, ['Apparel']);
  assert.equal(result.items[0].isNew, true);
  assert.equal(result.items[1].isNew, false);
  assert.equal(result.items[1].validTo, '');
  assert.equal(response.headers['cache-control'], 'no-store');
});

test('FOB filter returns matching groups or a successful empty result, without keyword search', async (t) => {
  const { bobbin } = await fixture(t);
  for (const [fob, expected] of [
    ['Apparel', ['ac-101']],
    ['Home', ['ac-102']],
    ['Beauty', []],
    ['unknown-fob', []],
  ] as const) {
    const response = await bobbin.inject(`${listQuery}&fob=${fob}`);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(
      response.json<DocumentResults>().items.map((document) => document.id),
      expected,
    );
    assert.equal(response.json<DocumentResults>().totalMatches, expected.length);
  }
  for (const suffix of [
    '&keyword=holiday',
    '&store=1002',
    '&division=72',
    '&target=https://example.com',
    '&asOf=2026-11-16',
  ]) {
    assert.equal((await bobbin.inject(listQuery + suffix)).statusCode, 400);
  }
  assert.equal((await bobbin.inject(`${listUrl}?category=unregistered`)).statusCode, 400);
});

test('metadata and both authorized page URLs preserve document/page identity and local image headers', async (t) => {
  const calls: string[] = [];
  const { bobbin } = await fixture(t, (upstream) => {
    upstream.addHook('onRequest', async (request) => {
      calls.push(request.url);
    });
  });
  const response = await bobbin.inject(`${listUrl}/ac-101`);
  assert.equal(response.statusCode, 200);
  const detail = response.json<DocumentDetail>();
  assert.equal(detail.id, 'ac-101');
  assert.equal(detail.pageCount, 2);
  assert.equal(detail.pages.length, 2);
  assert.ok(detail.description.includes('Synthetic'));
  for (const page of detail.pages) {
    assert.equal(page.url, `${listUrl}/ac-101/pages/${page.number}`);
    const image = await bobbin.inject(page.url);
    assert.equal(image.statusCode, 200);
    assert.match(String(image.headers['content-type']), /^image\/svg\+xml/);
    assert.equal(image.headers['cache-control'], 'no-store');
    assert.equal(image.headers['x-content-type-options'], 'nosniff');
    assert.equal(image.headers['content-security-policy'], "default-src 'none'; sandbox");
    assert.ok(image.body.startsWith('<svg '));
    assert.ok(image.body.includes('SYNTHETIC TRAINING ALERT'));
    assert.ok(image.body.includes(`Page ${page.number} of 2`));
  }
  assert.ok(calls.includes('/legacy/documents/101/pages/1'));
  assert.ok(calls.includes('/legacy/documents/101/pages/2'));
  assert.equal(calls.filter((path) => path === '/legacy/documents/101').length, 3);
});

test('every metadata and page request independently denies ineligible document scope', async (t) => {
  let imageCalls = 0;
  const { bobbin } = await fixture(t, (upstream) => {
    upstream.addHook('onRequest', async (request) => {
      if (/\/legacy\/documents\/\d+\/pages\//.test(request.url)) imageCalls++;
    });
  });
  for (const id of ['ac-103', 'ac-104', 'ac-105', 'ac-106', 'ac-107', 'ac-108']) {
    for (const suffix of ['', '/pages/1']) {
      const response = await bobbin.inject(`${listUrl}/${id}${suffix}`);
      assert.equal(response.statusCode, 403, id + suffix);
      assert.equal(response.json().error.code, 'DOCUMENT_FORBIDDEN');
      assert.equal(response.json().error.requestId, response.headers['x-request-id']);
      assert.ok(!response.body.includes('documentName'));
    }
  }
  assert.equal(imageCalls, 0);
  for (const suffix of ['', '/pages/1']) {
    const response = await bobbin.inject(`${listUrl}/ac-999${suffix}`);
    assert.equal(response.statusCode, 404);
    assert.equal(response.json().error.code, 'DOCUMENT_NOT_FOUND');
  }
});

test('page bounds and context overrides never bypass metadata authorization', async (t) => {
  const { bobbin } = await fixture(t);
  for (const page of ['0', '-1', '1.5', '01', 'text', '1000']) {
    assert.equal((await bobbin.inject(`${listUrl}/ac-101/pages/${page}`)).statusCode, 400);
  }
  assert.equal((await bobbin.inject(`${listUrl}/ac-101/pages/3`)).statusCode, 404);
  assert.equal((await bobbin.inject(`${listUrl}/ac-102/pages/2`)).statusCode, 404);
  assert.equal((await bobbin.inject(`${listUrl}/ac-101?division=72`)).statusCode, 400);
  assert.equal((await bobbin.inject(`${listUrl}/ac-101/pages/1?store=1002`)).statusCode, 400);
  const selected = await bobbin.inject({
    method: 'POST',
    url: '/api/session',
    payload: { profile: 'restricted' },
  });
  const cookie = String(selected.headers['set-cookie']).split(';')[0];
  assert.equal((await bobbin.inject({ url: listQuery, headers: { cookie } })).statusCode, 200);
  assert.equal(
    (await bobbin.inject({ url: `${listUrl}/ac-101/pages/1`, headers: { cookie } })).statusCode,
    200,
  );
});

test('list limit is truthful after eligibility filtering and document deduplication', async (t) => {
  const base = structuredClone(legacyDocuments[0]);
  const many = Array.from({ length: 51 }, (_, index) => {
    const id = String(200 + index);
    return {
      ...base,
      documentId: id,
      documentName: `Synthetic training ${id}`,
      metaDataArray: base.metaDataArray.map((field) => ({ ...field, docId: id })),
    };
  });
  const { bobbin } = await fixture(t, (upstream) => {
    upstream.addHook('onRequest', async (request, reply) => {
      if (request.url === '/legacy/documents/list')
        return reply.send({
          ok: true,
          synthetic: true,
          service: 'mock-upstream',
          documentData: many,
        });
    });
  });
  const response = await bobbin.inject(listQuery);
  assert.equal(response.statusCode, 200);
  const result = response.json<DocumentResults>();
  assert.equal(result.items.length, 50);
  assert.equal(result.totalMatches, 51);
  assert.equal(result.truncated, true);

  const duplicate = await fixture(t, (upstream) => {
    upstream.addHook('onRequest', async (request, reply) => {
      if (request.url === '/legacy/documents/list')
        return reply.send({
          ok: true,
          synthetic: true,
          service: 'mock-upstream',
          documentData: Array.from({ length: 51 }, () => base),
        });
    });
  });
  const unique = (await duplicate.bobbin.inject(listQuery)).json<DocumentResults>();
  assert.equal(unique.items.length, 1);
  assert.equal(unique.totalMatches, 1);
  assert.equal(unique.truncated, false);
});

test('dependency failures are explicit errors, not empty document lists', async (t) => {
  const { bobbin } = await fixture(t, (upstream) => {
    upstream.addHook('onRequest', async (request, reply) => {
      if (request.url.startsWith('/legacy/documents/'))
        return reply.code(503).send({ secret: 'source connection string' });
    });
  });
  for (const route of [listQuery, `${listUrl}/ac-101`, `${listUrl}/ac-101/pages/1`]) {
    const response = await bobbin.inject(route);
    assert.equal(response.statusCode, 502);
    assert.equal(response.json().error.code, 'UPSTREAM_FAILURE');
    assert.equal(response.json().error.requestId, response.headers['x-request-id']);
    assert.ok(!response.body.includes('connection string'));
  }
});

test('page content must match the authorized identity and plain synthetic image contract', async (t) => {
  for (const docImage of [
    {
      format: 'synthetic-page-v1',
      documentId: '102',
      pageNumber: 1,
      pageCount: 2,
      title: 'Wrong document',
      paragraphs: ['Sample'],
    },
    {
      format: 'synthetic-page-v1',
      documentId: '101',
      pageNumber: 2,
      pageCount: 2,
      title: 'Wrong page',
      paragraphs: ['Sample'],
    },
    {
      format: 'synthetic-page-v1',
      documentId: '101',
      pageNumber: 1,
      pageCount: 99,
      title: 'Wrong count',
      paragraphs: ['Sample'],
    },
    { format: 'image/svg+xml', svg: '<svg onload="alert(1)"/>' },
  ]) {
    const { bobbin } = await fixture(t, (upstream) => {
      upstream.addHook('onRequest', async (request, reply) => {
        if (request.url === '/legacy/documents/101/pages/1')
          return reply.send({ ok: true, synthetic: true, service: 'mock-upstream', docImage });
      });
    });
    const response = await bobbin.inject(`${listUrl}/ac-101/pages/1`);
    assert.equal(response.statusCode, 502);
    assert.equal(response.json().error.code, 'UPSTREAM_INVALID_RESPONSE');
  }
});
