import assert from 'node:assert/strict';
import test from 'node:test';
import { buildBobbin } from '../platform/bobbin/server/bobbin.ts';
import {
  InMemoryThreadArtifactRepository,
  ThreadArtifactDataError,
} from '../platform/thread/artifacts/repository.ts';
import type { ThreadActorRole } from '../platform/thread/inventory/contracts.ts';
import { InMemoryThreadBuildJobRepository } from '../platform/thread/jobs/repository.ts';
import type { NewThreadComponentRequest } from '../platform/thread/pipeline/contracts.ts';
import { InMemoryThreadRequestRepository } from '../platform/thread/pipeline/repository.ts';

const requestInput: NewThreadComponentRequest = {
  requestId: 'thread.request.agent-offer-callout',
  objectId: 'thread.component.agent-offer-callout',
  name: 'AgentOfferCallout',
  description: 'Presents a governed promotional message for associate-facing surfaces.',
  category: 'data-display',
  owner: { team: 'Thread Platform', issueLabel: 'thread:agent-offer-callout' },
  source: { kind: 'application', appId: 'associate-communications', sourcePath: 'offers/card' },
};

const submission = {
  candidate: {
    version: '0.1.0',
    code: {
      framework: 'react',
      packageName: '@macys/thread-react',
      exportName: 'AgentOfferCallout',
      sourcePath: 'platform/thread/candidates/agent-offer-callout.tsx',
    },
    figma: { status: 'unmapped' },
  },
  tests: { result: 'passed', artifactId: 'report:tests:agent-offer-callout' },
};

function server(
  requests: InMemoryThreadRequestRepository,
  jobs: InMemoryThreadBuildJobRepository,
  artifacts: InMemoryThreadArtifactRepository,
  role?: ThreadActorRole,
) {
  return buildBobbin({
    upstreamUrl: 'http://127.0.0.1:1',
    threadRequestRepository: requests,
    threadBuildJobRepository: jobs,
    threadArtifactRepository: artifacts,
    ...(role ? { threadManagementActor: role } : {}),
  });
}

test('ordinary application sessions cannot inspect or operate the build workbench', async (t) => {
  const requests = new InMemoryThreadRequestRepository();
  const jobs = new InMemoryThreadBuildJobRepository();
  const artifacts = new InMemoryThreadArtifactRepository();
  const ordinary = server(requests, jobs, artifacts);
  t.after(() => ordinary.close());
  assert.equal((await ordinary.inject('/api/thread/v1/workbench')).statusCode, 403);
  assert.equal((await ordinary.inject('/api/thread/v1/build-jobs')).statusCode, 403);
  assert.equal((await ordinary.inject('/api/thread/v1/artifacts')).statusCode, 403);
  assert.equal(
    (
      await ordinary.inject({
        method: 'POST',
        url: `${'/api/thread/v1/requests'}/${requestInput.requestId}/build-jobs`,
        payload: { jobId: 'thread.build-job.agent-offer-callout' },
      })
    ).statusCode,
    403,
  );
});

test('agent API advances a durable job while output remains inert until attachment', async (t) => {
  const requests = new InMemoryThreadRequestRepository();
  const jobs = new InMemoryThreadBuildJobRepository();
  const artifacts = new InMemoryThreadArtifactRepository();
  const agent = server(requests, jobs, artifacts, 'agent');
  const engineer = server(requests, jobs, artifacts, 'engineer');
  t.after(async () => Promise.all([agent.close(), engineer.close()]));

  assert.equal(
    (await agent.inject({ method: 'POST', url: '/api/thread/v1/requests', payload: requestInput }))
      .statusCode,
    201,
  );
  const requestBase = `/api/thread/v1/requests/${requestInput.requestId}`;
  const jobBase = '/api/thread/v1/build-jobs/thread.build-job.agent-offer-callout';
  assert.equal(
    (
      await agent.inject({
        method: 'POST',
        url: `${requestBase}/build-jobs`,
        payload: { jobId: 'thread.build-job.agent-offer-callout' },
      })
    ).statusCode,
    201,
  );
  assert.equal((await agent.inject({ method: 'POST', url: `${jobBase}/claim` })).statusCode, 200);
  assert.equal(
    (await agent.inject({ method: 'POST', url: `${jobBase}/submit`, payload: submission }))
      .statusCode,
    200,
  );
  assert.equal((await requests.get(requestInput.requestId))?.status, 'requested');
  assert.equal((await jobs.get('thread.build-job.agent-offer-callout'))?.status, 'candidate-ready');

  assert.equal(
    (await agent.inject({ method: 'POST', url: `${jobBase}/attach` })).statusCode,
    409,
    'candidate metadata alone cannot bypass verified artifact evidence',
  );
  const artifactBase = '/api/thread/v1/artifacts/thread.artifact.agent-offer-callout';
  assert.equal(
    (
      await agent.inject({
        method: 'POST',
        url: `${jobBase}/artifacts`,
        payload: {
          artifactId: 'thread.artifact.agent-offer-callout',
          content: {
            sha256: 'a'.repeat(64),
            sizeBytes: 4096,
            mediaType: 'application/gzip',
          },
          sourceEvidence: {
            buildLogArtifactId: 'build:agent-offer-callout',
            sbomArtifactId: 'sbom:agent-offer-callout',
          },
        },
      })
    ).statusCode,
    201,
  );
  const verification = {
    provenance: { result: 'passed', artifactId: 'verify:provenance:agent-offer-callout' },
    dependencyAudit: { result: 'passed', artifactId: 'verify:dependencies:agent-offer-callout' },
    licenseReview: { result: 'passed', artifactId: 'verify:licenses:agent-offer-callout' },
  };
  assert.equal(
    (
      await agent.inject({
        method: 'POST',
        url: `${artifactBase}/verify`,
        payload: verification,
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await engineer.inject({
        method: 'POST',
        url: `${artifactBase}/verify`,
        payload: verification,
      })
    ).statusCode,
    200,
  );
  const attached = await agent.inject({ method: 'POST', url: `${jobBase}/attach` });
  assert.equal(attached.statusCode, 200);
  assert.equal(attached.json<{ request: { status: string } }>().request.status, 'candidate');
  assert.equal(
    (await requests.get(requestInput.requestId))?.candidate?.version.quality.tests,
    'passed',
  );
  assert.equal((await jobs.get('thread.build-job.agent-offer-callout'))?.status, 'attached');
  assert.equal((await artifacts.get('thread.artifact.agent-offer-callout'))?.status, 'verified');

  const workbench = await agent.inject('/api/thread/v1/workbench');
  assert.equal(workbench.statusCode, 200);
  assert.deepEqual(
    workbench.json<{ items: { allowedActions: string[] }[] }>().items[0].allowedActions,
    ['submit-review'],
  );
});

test('build API derives roles server-side and rejects designer jobs and spoof fields', async (t) => {
  const requests = new InMemoryThreadRequestRepository();
  const jobs = new InMemoryThreadBuildJobRepository();
  const artifacts = new InMemoryThreadArtifactRepository();
  const agent = server(requests, jobs, artifacts, 'agent');
  const designer = server(requests, jobs, artifacts, 'designer');
  t.after(async () => Promise.all([agent.close(), designer.close()]));
  await agent.inject({ method: 'POST', url: '/api/thread/v1/requests', payload: requestInput });
  const url = `/api/thread/v1/requests/${requestInput.requestId}/build-jobs`;
  assert.equal(
    (
      await designer.inject({
        method: 'POST',
        url,
        payload: { jobId: 'thread.build-job.agent-offer-callout' },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await agent.inject({
        method: 'POST',
        url,
        payload: { jobId: 'thread.build-job.agent-offer-callout', actor: 'governance' },
      })
    ).statusCode,
    400,
  );
  assert.deepEqual(await jobs.list(), []);
});

test('artifact corruption makes the protected workbench unavailable without leaking content', async (t) => {
  const bobbin = buildBobbin({
    upstreamUrl: 'http://127.0.0.1:1',
    threadRequestRepository: new InMemoryThreadRequestRepository(),
    threadBuildJobRepository: new InMemoryThreadBuildJobRepository(),
    threadArtifactRepository: {
      list: async () => {
        throw new ThreadArtifactDataError('sensitive artifact repository content');
      },
      get: async () => undefined,
      listByJob: async () => [],
      getLatestByJob: async () => undefined,
      getVerifiedByJob: async () => undefined,
      save: async () => {
        throw new Error('not used');
      },
    },
    threadManagementActor: 'engineer',
  });
  t.after(() => bobbin.close());
  const response = await bobbin.inject('/api/thread/v1/workbench');
  assert.equal(response.statusCode, 503);
  assert.doesNotMatch(response.body, /sensitive artifact repository content/);
});
