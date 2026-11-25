import assert from 'node:assert/strict';
import test from 'node:test';
import { buildBobbin } from '../platform/bobbin/server/bobbin.ts';
import type { ThreadActorRole } from '../platform/thread/inventory/contracts.ts';
import type { NewThreadComponentRequest } from '../platform/thread/pipeline/contracts.ts';
import { InMemoryThreadRequestRepository } from '../platform/thread/pipeline/repository.ts';

function gapRequirement(
  overrides: Partial<NewThreadComponentRequest> = {},
): NewThreadComponentRequest {
  return {
    requestId: 'thread.request.status-timeline-discovery-api',
    objectId: 'thread.component.status-timeline-discovery-api',
    name: 'StatusTimelineDiscoveryApi',
    description: 'Displays an ordered sequence of lifecycle events and their status.',
    category: 'domain',
    owner: { team: 'Thread Platform', issueLabel: 'thread:status-timeline' },
    source: {
      kind: 'figma',
      fileKey: 'figma-file-poc',
      componentKey: 'status-timeline-key',
      nodeId: '1234:5678',
    },
    ...overrides,
  };
}

function server(repository: InMemoryThreadRequestRepository, role?: ThreadActorRole) {
  return buildBobbin({
    upstreamUrl: 'http://127.0.0.1:1',
    threadRequestRepository: repository,
    ...(role ? { threadManagementActor: role } : {}),
  });
}

test('ordinary application sessions may preview discovery but cannot open requests', async (t) => {
  const repository = new InMemoryThreadRequestRepository();
  const bobbin = server(repository);
  t.after(() => bobbin.close());

  const preview = await bobbin.inject({
    method: 'POST',
    url: '/api/thread/v1/discovery',
    payload: gapRequirement(),
  });
  assert.equal(preview.statusCode, 200);
  assert.equal(preview.json<{ decision: string }>().decision, 'inventory-gap');
  assert.equal(
    (
      await bobbin.inject({
        method: 'POST',
        url: '/api/thread/v1/discovery/request',
        payload: gapRequirement(),
      })
    ).statusCode,
    403,
  );
  assert.deepEqual(await repository.list(), []);
});

test('discover-and-request creates only a genuine gap and rejects duplicate requirements', async (t) => {
  const repository = new InMemoryThreadRequestRepository();
  const agent = server(repository, 'agent');
  t.after(() => agent.close());

  const created = await agent.inject({
    method: 'POST',
    url: '/api/thread/v1/discovery/request',
    payload: gapRequirement(),
  });
  assert.equal(created.statusCode, 201);
  assert.equal(created.json<{ request: { requestedBy: string } }>().request.requestedBy, 'agent');
  assert.deepEqual(
    created.json<{ discovery: { requirement: { source: unknown } } }>().discovery.requirement
      .source,
    gapRequirement().source,
  );

  const duplicate = await agent.inject({
    method: 'POST',
    url: '/api/thread/v1/discovery/request',
    payload: gapRequirement({
      requestId: 'thread.request.status-timeline-discovery-api-second',
      objectId: 'thread.component.status-timeline-discovery-api-second',
    }),
  });
  assert.equal(duplicate.statusCode, 409);
  assert.match(duplicate.body, /THREAD_REQUEST_DUPLICATE/);
  assert.equal((await repository.list()).length, 1);
});

test('existing blocked inventory stops automatic request creation', async (t) => {
  const repository = new InMemoryThreadRequestRepository();
  const agent = server(repository, 'agent');
  t.after(() => agent.close());
  const response = await agent.inject({
    method: 'POST',
    url: '/api/thread/v1/discovery/request',
    payload: gapRequirement({
      requestId: 'thread.request.button-discovery-api',
      objectId: 'thread.component.button',
      name: 'Button',
      description: 'Shared button primitive.',
      category: 'primitive',
    }),
  });
  assert.equal(response.statusCode, 200);
  assert.equal(
    response.json<{ discovery: { decision: string } }>().discovery.decision,
    'review-alternatives',
  );
  assert.equal(response.json<{ request: unknown }>().request, null);
  assert.deepEqual(await repository.list(), []);
});

test('discovery contracts reject actor spoofing and unsupported fields', async (t) => {
  const repository = new InMemoryThreadRequestRepository();
  const agent = server(repository, 'agent');
  t.after(() => agent.close());
  const response = await agent.inject({
    method: 'POST',
    url: '/api/thread/v1/discovery/request',
    payload: { ...gapRequirement(), actor: 'governance' },
  });
  assert.equal(response.statusCode, 400);
  assert.deepEqual(await repository.list(), []);
});
