import assert from 'node:assert/strict';
import test from 'node:test';
import { buildBobbin } from '../platform/bobbin/server/bobbin.ts';
import type { ThreadActorRole } from '../platform/thread/inventory/contracts.ts';
import type { NewThreadComponentRequest } from '../platform/thread/pipeline/contracts.ts';
import { InMemoryThreadRequestRepository } from '../platform/thread/pipeline/repository.ts';

const requestInput: NewThreadComponentRequest = {
  requestId: 'thread.request.status-timeline-api',
  objectId: 'thread.component.status-timeline-api',
  name: 'StatusTimelineApi',
  description: 'Presents a bounded sequence of labelled domain status events.',
  category: 'data-display',
  owner: { team: 'Thread Platform', issueLabel: 'thread:status-timeline' },
  source: {
    kind: 'figma',
    fileKey: 'figma-file-poc',
    componentKey: 'status-timeline-key',
    nodeId: '1234:5678',
  },
};

const candidateInput = {
  version: '0.1.0',
  code: {
    framework: 'react' as const,
    packageName: '@macys/thread-react',
    exportName: 'StatusTimelineApi',
    sourcePath: 'platform/thread/candidates/status-timeline.tsx',
  },
  figma: {
    status: 'mapped' as const,
    fileKey: 'figma-file-poc',
    componentKey: 'status-timeline-key',
    nodeId: '1234:5678',
  },
};

function server(repository: InMemoryThreadRequestRepository, role?: ThreadActorRole) {
  return buildBobbin({
    upstreamUrl: 'http://127.0.0.1:1',
    threadRequestRepository: repository,
    ...(role ? { threadManagementActor: role } : {}),
  });
}

test('ordinary application sessions can read inventory but cannot inspect or mutate requests', async (t) => {
  const repository = new InMemoryThreadRequestRepository();
  const bobbin = server(repository);
  t.after(() => bobbin.close());

  const inventory = await bobbin.inject('/api/thread/v1/inventory');
  assert.equal(inventory.statusCode, 200);
  assert.equal(inventory.json<{ total: number }>().total, 12);
  assert.equal((await bobbin.inject('/api/thread/v1/requests')).statusCode, 403);
  assert.equal(
    (
      await bobbin.inject({
        method: 'POST',
        url: '/api/thread/v1/requests',
        payload: requestInput,
      })
    ).statusCode,
    403,
  );
  assert.deepEqual(await repository.list(), []);
});

test('workflow actor is server-derived and request payloads cannot claim another role', async (t) => {
  const repository = new InMemoryThreadRequestRepository();
  const agent = server(repository, 'agent');
  t.after(() => agent.close());

  const spoofed = await agent.inject({
    method: 'POST',
    url: '/api/thread/v1/requests',
    payload: { ...requestInput, actor: 'governance' },
  });
  assert.equal(spoofed.statusCode, 400);
  assert.deepEqual(await repository.list(), []);

  const created = await agent.inject({
    method: 'POST',
    url: '/api/thread/v1/requests',
    payload: requestInput,
  });
  assert.equal(created.statusCode, 201);
  assert.equal(created.json<{ requestedBy: string }>().requestedBy, 'agent');
  const listed = await agent.inject('/api/thread/v1/requests');
  assert.equal(listed.statusCode, 200);
  assert.equal(listed.json<{ total: number }>().total, 1);
});

test('agent, reviewer and governance API roles complete one durable governed workflow', async (t) => {
  const repository = new InMemoryThreadRequestRepository();
  const agent = server(repository, 'agent');
  const designer = server(repository, 'designer');
  const engineer = server(repository, 'engineer');
  const governance = server(repository, 'governance');
  const ordinary = server(repository);
  t.after(async () => {
    await Promise.all([
      agent.close(),
      designer.close(),
      engineer.close(),
      governance.close(),
      ordinary.close(),
    ]);
  });
  const base = '/api/thread/v1/requests/thread.request.status-timeline-api';

  assert.equal(
    (
      await agent.inject({
        method: 'POST',
        url: '/api/thread/v1/requests',
        payload: requestInput,
      })
    ).statusCode,
    201,
  );
  assert.equal(
    (await agent.inject({ method: 'POST', url: `${base}/candidate`, payload: candidateInput }))
      .statusCode,
    200,
  );
  assert.equal(
    (
      await agent.inject({
        method: 'POST',
        url: `${base}/evidence`,
        payload: { gate: 'tests', result: 'passed', artifactId: 'report:tests:api' },
      })
    ).statusCode,
    200,
  );
  assert.equal((await agent.inject({ method: 'POST', url: `${base}/submit` })).statusCode, 200);
  assert.equal((await agent.inject({ method: 'POST', url: `${base}/approve` })).statusCode, 403);

  for (const [gate, artifactId] of [
    ['accessibility', 'report:a11y:api'],
    ['designReview', 'review:design:api'],
  ] as const) {
    assert.equal(
      (
        await designer.inject({
          method: 'POST',
          url: `${base}/evidence`,
          payload: { gate, result: 'passed', artifactId },
        })
      ).statusCode,
      200,
    );
  }
  assert.equal(
    (
      await engineer.inject({
        method: 'POST',
        url: `${base}/evidence`,
        payload: {
          gate: 'securityReview',
          result: 'passed',
          artifactId: 'review:security:api',
        },
      })
    ).statusCode,
    200,
  );

  const approved = await governance.inject({ method: 'POST', url: `${base}/approve` });
  assert.equal(approved.statusCode, 200);
  assert.equal(approved.json<{ request: { status: string } }>().request.status, 'approved');
  assert.equal((await repository.get(requestInput.requestId))?.status, 'approved');

  const inventory = await governance.inject('/api/thread/v1/inventory');
  assert.equal(inventory.json<{ total: number }>().total, 12);
  assert.equal(
    (await ordinary.inject('/api/thread/v1/requests')).statusCode,
    403,
    'approval does not weaken ordinary application-session visibility',
  );
});

test('repository corruption is reported as unavailable without exposing stored content', async (t) => {
  const repository = {
    list: async () => {
      throw new (
        await import('../platform/thread/pipeline/repository.ts')
      ).ThreadRepositoryDataError('sensitive file content');
    },
    get: async () => undefined,
    save: async () => {
      throw new Error('not used');
    },
  };
  const bobbin = buildBobbin({
    upstreamUrl: 'http://127.0.0.1:1',
    threadRequestRepository: repository,
    threadManagementActor: 'governance',
  });
  t.after(() => bobbin.close());
  const response = await bobbin.inject('/api/thread/v1/requests');
  assert.equal(response.statusCode, 503);
  assert.doesNotMatch(response.body, /sensitive file content/);
});
