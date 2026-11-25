import assert from 'node:assert/strict';
import test from 'node:test';
import { buildBobbin } from '../platform/bobbin/server/bobbin.ts';
import { InMemoryThreadArtifactRepository } from '../platform/thread/artifacts/repository.ts';
import { InMemoryThreadAutomationRunRepository } from '../platform/thread/automation/repository.ts';
import type { ThreadActorRole } from '../platform/thread/inventory/contracts.ts';
import { InMemoryThreadBuildJobRepository } from '../platform/thread/jobs/repository.ts';
import { InMemoryThreadRequestRepository } from '../platform/thread/pipeline/repository.ts';
import { InMemoryThreadReleaseRepository } from '../platform/thread/releases/repository.ts';

function stores() {
  return {
    threadRequestRepository: new InMemoryThreadRequestRepository(),
    threadBuildJobRepository: new InMemoryThreadBuildJobRepository(),
    threadArtifactRepository: new InMemoryThreadArtifactRepository(),
    threadAutomationRunRepository: new InMemoryThreadAutomationRunRepository(),
    threadReleaseRepository: new InMemoryThreadReleaseRepository(),
  };
}

function server(shared: ReturnType<typeof stores>, role?: ThreadActorRole) {
  return buildBobbin({
    upstreamUrl: 'http://127.0.0.1:1',
    ...shared,
    ...(role ? { threadManagementActor: role } : {}),
  });
}

const verification = {
  provenance: { result: 'passed', artifactId: 'verify:provenance:promotion-banner-auto' },
  dependencyAudit: { result: 'passed', artifactId: 'verify:dependencies:promotion-banner-auto' },
  licenseReview: { result: 'passed', artifactId: 'verify:licenses:promotion-banner-auto' },
};

const discoveryInput = {
  requestId: 'thread.request.later-promotion-banner-auto',
  objectId: 'thread.component.promotion-banner-auto',
  name: 'PromotionBannerAuto',
  description: 'Presents a governed store promotion with bounded marketing content.',
  category: 'domain',
  owner: { team: 'Thread Platform', issueLabel: 'thread:later-promotion-banner-auto' },
  source: { kind: 'application', appId: 'later-app', sourcePath: 'offers/promotion-banner-auto' },
};

test('application sessions can read the combined inventory but cannot inspect release audit records', async (t) => {
  const shared = stores();
  const ordinary = server(shared);
  t.after(() => ordinary.close());
  const inventory = await ordinary.inject('/api/thread/v1/inventory');
  assert.equal(inventory.statusCode, 200);
  assert.equal(inventory.json<{ total: number }>().total, 12);
  assert.equal((await ordinary.inject('/api/thread/v1/releases')).statusCode, 403);
});

test('end-to-end API promotes a verified candidate into discovery and preserves rollback audit', async (t) => {
  const shared = stores();
  const agent = server(shared, 'agent');
  const designer = server(shared, 'designer');
  const engineer = server(shared, 'engineer');
  const governance = server(shared, 'governance');
  const ordinary = server(shared);
  t.after(async () => Promise.all([agent.close(), designer.close(), engineer.close(), governance.close(), ordinary.close()]));

  const automation = await agent.inject({
    method: 'POST',
    url: '/api/thread/v1/automation/runs',
    payload: { runId: 'thread.adapter-run.phase-eleven-release', fixtureId: 'figma-promotion-banner' },
  });
  assert.equal(automation.statusCode, 201);
  assert.equal(automation.json<{ outcome: string }>().outcome, 'artifact-staged');

  const requestId = 'thread.request.promotion-banner-auto';
  const jobId = 'thread.build-job.promotion-banner-auto';
  const artifactId = 'thread.artifact.promotion-banner-auto';
  assert.equal(
    (
      await engineer.inject({
        method: 'POST',
        url: `/api/thread/v1/artifacts/${artifactId}/verify`,
        payload: verification,
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (await agent.inject({ method: 'POST', url: `/api/thread/v1/build-jobs/${jobId}/attach` })).statusCode,
    200,
  );
  assert.equal(
    (await agent.inject({ method: 'POST', url: `/api/thread/v1/requests/${requestId}/submit` })).statusCode,
    200,
  );

  for (const [app, gate, artifact] of [
    [designer, 'accessibility', 'review:accessibility:promotion-banner-auto'],
    [designer, 'designReview', 'review:design:promotion-banner-auto'],
    [engineer, 'securityReview', 'review:security:promotion-banner-auto'],
  ] as const) {
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: `/api/thread/v1/requests/${requestId}/evidence`,
          payload: { gate, result: 'passed', artifactId: artifact },
        })
      ).statusCode,
      200,
    );
  }
  assert.equal(
    (await governance.inject({ method: 'POST', url: `/api/thread/v1/requests/${requestId}/approve` })).statusCode,
    200,
  );
  const promoted = await governance.inject({
    method: 'POST',
    url: `/api/thread/v1/requests/${requestId}/releases`,
    payload: { releaseId: 'thread.release.promotion-banner-auto' },
  });
  assert.equal(promoted.statusCode, 201);
  assert.equal(promoted.json<{ status: string }>().status, 'active');

  const inventory = await ordinary.inject('/api/thread/v1/inventory');
  assert.equal(inventory.json<{ total: number }>().total, 13);
  const discovery = await ordinary.inject({
    method: 'POST',
    url: '/api/thread/v1/discovery',
    payload: discoveryInput,
  });
  assert.equal(discovery.json<{ decision: string }>().decision, 'reuse');
  const workbench = await governance.inject('/api/thread/v1/workbench');
  assert.deepEqual(
    workbench.json<{ items: { request: { requestId: string }; allowedActions: string[] }[] }>()
      .items.find((item) => item.request.requestId === requestId)?.allowedActions,
    ['rollback-release'],
  );

  const rolledBack = await governance.inject({
    method: 'POST',
    url: '/api/thread/v1/releases/thread.release.promotion-banner-auto/rollback',
    payload: {
      reason: 'Controlled rollback proves audit preservation after promotion.',
      evidenceId: 'rollback:phase-eleven:promotion-banner-auto',
    },
  });
  assert.equal(rolledBack.statusCode, 200);
  assert.equal(rolledBack.json<{ status: string }>().status, 'rolled-back');
  const afterRollback = await ordinary.inject({
    method: 'POST',
    url: '/api/thread/v1/discovery',
    payload: discoveryInput,
  });
  assert.equal(afterRollback.json<{ decision: string }>().decision, 'review-alternatives');
  assert.equal(afterRollback.json<{ exactMatch: { status: string } }>().exactMatch.status, 'deprecated');
  assert.equal((await shared.threadReleaseRepository.list()).length, 1);
});

test('release API derives governance server-side and rejects spoofed or extra fields', async (t) => {
  const shared = stores();
  const agent = server(shared, 'agent');
  const governance = server(shared, 'governance');
  t.after(async () => Promise.all([agent.close(), governance.close()]));
  assert.equal(
    (
      await agent.inject({
        method: 'POST',
        url: '/api/thread/v1/requests/thread.request.promotion-banner-auto/releases',
        payload: { releaseId: 'thread.release.promotion-banner-auto' },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await governance.inject({
        method: 'POST',
        url: '/api/thread/v1/requests/thread.request.promotion-banner-auto/releases',
        payload: {
          releaseId: 'thread.release.promotion-banner-auto',
          promotedBy: 'governance',
          packageUrl: 'https://example.invalid/package.tgz',
        },
      })
    ).statusCode,
    400,
  );
});
