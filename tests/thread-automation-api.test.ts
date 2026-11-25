import assert from 'node:assert/strict';
import test from 'node:test';
import { buildBobbin } from '../platform/bobbin/server/bobbin.ts';
import { InMemoryThreadArtifactRepository } from '../platform/thread/artifacts/repository.ts';
import { InMemoryThreadAutomationRunRepository } from '../platform/thread/automation/repository.ts';
import { InMemoryThreadBuildJobRepository } from '../platform/thread/jobs/repository.ts';
import { InMemoryThreadRequestRepository } from '../platform/thread/pipeline/repository.ts';

function repositories() {
  return {
    threadRequestRepository: new InMemoryThreadRequestRepository(),
    threadBuildJobRepository: new InMemoryThreadBuildJobRepository(),
    threadArtifactRepository: new InMemoryThreadArtifactRepository(),
    threadAutomationRunRepository: new InMemoryThreadAutomationRunRepository(),
  };
}

test('ordinary sessions cannot inspect or invoke controlled adapters', async (t) => {
  const app = buildBobbin({ upstreamUrl: 'http://127.0.0.1:1', ...repositories() });
  t.after(() => app.close());
  assert.equal((await app.inject('/api/thread/v1/automation/runs')).statusCode, 403);
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/thread/v1/automation/runs',
        payload: { runId: 'thread.adapter-run.ordinary', fixtureId: 'inventory-button' },
      })
    ).statusCode,
    403,
  );
});

test('agent API records reuse and gap outcomes and safely replays a run ID', async (t) => {
  const stores = repositories();
  const app = buildBobbin({
    upstreamUrl: 'http://127.0.0.1:1',
    threadManagementActor: 'agent',
    ...stores,
  });
  t.after(() => app.close());
  const reusePayload = { runId: 'thread.adapter-run.api-button', fixtureId: 'inventory-button' };
  const reuse = await app.inject({ method: 'POST', url: '/api/thread/v1/automation/runs', payload: reusePayload });
  assert.equal(reuse.statusCode, 201);
  assert.equal(reuse.json<{ outcome: string }>().outcome, 'inventory-resolved');
  assert.equal(
    (await app.inject({ method: 'POST', url: '/api/thread/v1/automation/runs', payload: reusePayload })).statusCode,
    200,
  );

  const gap = await app.inject({
    method: 'POST',
    url: '/api/thread/v1/automation/runs',
    payload: { runId: 'thread.adapter-run.api-promotion', fixtureId: 'figma-promotion-banner' },
  });
  assert.equal(gap.statusCode, 201);
  assert.equal(gap.json<{ outcome: string }>().outcome, 'artifact-staged');
  assert.equal((await stores.threadArtifactRepository.list())[0].status, 'staged');
  assert.equal((await app.inject('/api/thread/v1/automation/runs')).json<{ total: number }>().total, 2);
});

test('automation API rejects arbitrary connector fields before adapter execution', async (t) => {
  const stores = repositories();
  const app = buildBobbin({
    upstreamUrl: 'http://127.0.0.1:1',
    threadManagementActor: 'agent',
    ...stores,
  });
  t.after(() => app.close());
  const response = await app.inject({
    method: 'POST',
    url: '/api/thread/v1/automation/runs',
    payload: {
      runId: 'thread.adapter-run.unsafe',
      fixtureId: 'figma-promotion-banner',
      figmaUrl: 'https://example.invalid/file',
      accessToken: 'not-accepted',
      command: 'npm install',
    },
  });
  assert.equal(response.statusCode, 400);
  assert.equal((await stores.threadAutomationRunRepository.list()).length, 0);
});
