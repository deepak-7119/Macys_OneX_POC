import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  stageThreadArtifact,
  verifyThreadArtifact,
} from '../platform/thread/artifacts/workflow.ts';
import type { NewThreadBuildSubmission } from '../platform/thread/jobs/contracts.ts';
import {
  FileThreadBuildJobRepository,
  InMemoryThreadBuildJobRepository,
  ThreadBuildJobConflictError,
  ThreadBuildJobDataError,
} from '../platform/thread/jobs/repository.ts';
import { validateThreadBuildJob } from '../platform/thread/jobs/validation.ts';
import { buildThreadWorkbench } from '../platform/thread/jobs/workbench.ts';
import {
  attachThreadBuildJob,
  claimThreadBuildJob,
  createThreadBuildJob,
  submitThreadBuildJob,
} from '../platform/thread/jobs/workflow.ts';
import type { NewThreadComponentRequest } from '../platform/thread/pipeline/contracts.ts';
import {
  createThreadComponentRequest,
  recordThreadCandidateEvidence,
  submitThreadCandidateForReview,
} from '../platform/thread/pipeline/workflow.ts';

const at = {
  request: '2026-11-17T09:00:00.000Z',
  queued: '2026-11-17T09:01:00.000Z',
  running: '2026-11-17T09:02:00.000Z',
  submitted: '2026-11-17T09:03:00.000Z',
  attached: '2026-11-17T09:04:00.000Z',
  retry: '2026-11-17T09:05:00.000Z',
  review: '2026-11-17T09:06:00.000Z',
};

const input: NewThreadComponentRequest = {
  requestId: 'thread.request.offer-callout',
  objectId: 'thread.component.offer-callout',
  name: 'OfferCallout',
  description: 'Presents a governed promotional message for associate-facing surfaces.',
  category: 'data-display',
  owner: { team: 'Thread Platform', issueLabel: 'thread:offer-callout' },
  source: {
    kind: 'figma',
    fileKey: 'figma-file-poc',
    componentKey: 'offer-callout-key',
    nodeId: '91:42',
  },
};

const submission: NewThreadBuildSubmission = {
  candidate: {
    version: '0.1.0',
    code: {
      framework: 'react',
      packageName: '@macys/thread-react',
      exportName: 'OfferCallout',
      sourcePath: 'platform/thread/candidates/offer-callout.tsx',
    },
    figma: {
      status: 'mapped',
      fileKey: 'figma-file-poc',
      componentKey: 'offer-callout-key',
      nodeId: '91:42',
    },
  },
  tests: { result: 'passed', artifactId: 'report:tests:offer-callout' },
};

function requested() {
  return createThreadComponentRequest(input, 'agent', at.request);
}

function readyJob() {
  const request = requested();
  const queued = createThreadBuildJob(
    'thread.build-job.offer-callout',
    request,
    'agent',
    at.queued,
  );
  const running = claimThreadBuildJob(queued, 'agent', at.running);
  return {
    request,
    job: submitThreadBuildJob(running, request, submission, 'agent', at.submitted),
  };
}

test('build jobs keep generated output inert until an explicit governed attachment', () => {
  const request = requested();
  const queued = createThreadBuildJob(
    'thread.build-job.offer-callout',
    request,
    'agent',
    at.queued,
  );
  const running = claimThreadBuildJob(queued, 'agent', at.running);
  const ready = submitThreadBuildJob(running, request, submission, 'agent', at.submitted);

  assert.equal(request.status, 'requested');
  assert.equal(ready.status, 'candidate-ready');
  assert.equal(ready.output?.candidate.code.exportName, 'OfferCallout');
  const attached = attachThreadBuildJob(ready, request, 'engineer', at.attached);
  assert.equal(attached.job.status, 'attached');
  assert.equal(attached.request.status, 'candidate');
  assert.equal(attached.request.candidate?.version.quality.tests, 'passed');
  assert.equal(attached.request.candidate?.evidence.tests?.recordedBy, 'agent');
});

test('build-job roles, claiming role and source bindings are enforced', () => {
  const request = requested();
  assert.throws(
    () => createThreadBuildJob('thread.build-job.offer-callout', request, 'designer', at.queued),
    /not allowed/,
  );
  const queued = createThreadBuildJob(
    'thread.build-job.offer-callout',
    request,
    'agent',
    at.queued,
  );
  assert.throws(() => claimThreadBuildJob(queued, 'governance', at.running), /not allowed/);
  const running = claimThreadBuildJob(queued, 'agent', at.running);
  assert.throws(
    () => submitThreadBuildJob(running, request, submission, 'engineer', at.submitted),
    /claiming role/,
  );
  assert.throws(() =>
    submitThreadBuildJob(
      running,
      request,
      {
        ...submission,
        candidate: { ...submission.candidate, figma: { status: 'unmapped' } },
      },
      'agent',
      at.submitted,
    ),
  );
});

test('an exact candidate attachment can repair a partially committed two-repository update', () => {
  const { request, job } = readyJob();
  const first = attachThreadBuildJob(job, request, 'agent', at.attached);
  const repaired = attachThreadBuildJob(job, first.request, 'engineer', at.retry);
  assert.deepEqual(repaired.request, first.request);
  assert.equal(repaired.job.status, 'attached');
  assert.equal(repaired.job.attachedAt, at.retry);
});

test('build-job validation rejects executable fields and inconsistent lifecycle data', () => {
  const { job } = readyJob();
  assert.throws(() => validateThreadBuildJob({ ...job, executable: 'alert(1)' }));
  assert.throws(() =>
    validateThreadBuildJob({ ...job, status: 'queued', output: job.output, claimedBy: undefined }),
  );
});

test('file build-job repository persists safely and rejects duplicate request jobs and stale writes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'overlock-build-jobs-'));
  const path = join(directory, 'jobs.json');
  const repository = new FileThreadBuildJobRepository(path);
  const request = requested();
  const job = createThreadBuildJob('thread.build-job.offer-callout', request, 'agent', at.queued);
  await repository.save(job);
  assert.deepEqual(await new FileThreadBuildJobRepository(path).get(job.jobId), job);

  const duplicate = createThreadBuildJob(
    'thread.build-job.offer-callout-second',
    request,
    'engineer',
    at.running,
  );
  await assert.rejects(() => repository.save(duplicate), ThreadBuildJobConflictError);
  const running = claimThreadBuildJob(job, 'agent', at.running);
  await repository.save(running, job.updatedAt);
  await assert.rejects(() => repository.save(running, job.updatedAt), ThreadBuildJobConflictError);
});

test('file build-job repository fails closed on malformed records', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'overlock-build-jobs-invalid-'));
  const path = join(directory, 'jobs.json');
  await writeFile(path, '{"schemaVersion":1,"jobs":[{"secret":"not-a-job"}]}');
  await assert.rejects(
    () => new FileThreadBuildJobRepository(path).list(),
    ThreadBuildJobDataError,
  );
});

test('workbench actions are derived from role and durable workflow state', async () => {
  const request = requested();
  assert.deepEqual(buildThreadWorkbench([request], [], [], 'agent')[0].allowedActions, [
    'create-build-job',
  ]);
  const repository = new InMemoryThreadBuildJobRepository();
  const queued = createThreadBuildJob(
    'thread.build-job.offer-callout',
    request,
    'agent',
    at.queued,
  );
  await repository.save(queued);
  assert.deepEqual(buildThreadWorkbench([request], [queued], [], 'agent')[0].allowedActions, [
    'claim-build-job',
  ]);
  const { job } = readyJob();
  assert.deepEqual(buildThreadWorkbench([request], [job], [], 'agent')[0].allowedActions, [
    'stage-artifact',
  ]);
  const artifact = stageThreadArtifact(
    job,
    {
      artifactId: 'thread.artifact.offer-callout',
      content: { sha256: 'a'.repeat(64), sizeBytes: 4096, mediaType: 'application/gzip' },
      sourceEvidence: {
        buildLogArtifactId: 'build:offer-callout',
        sbomArtifactId: 'sbom:offer-callout',
      },
    },
    'agent',
    at.attached,
  );
  assert.deepEqual(
    buildThreadWorkbench([request], [job], [artifact], 'engineer')[0].allowedActions,
    ['verify-artifact'],
  );
  const verified = verifyThreadArtifact(
    artifact,
    {
      provenance: { result: 'passed', artifactId: 'verify:provenance:offer-callout' },
      dependencyAudit: { result: 'passed', artifactId: 'verify:dependencies:offer-callout' },
      licenseReview: { result: 'passed', artifactId: 'verify:licenses:offer-callout' },
    },
    'engineer',
    at.retry,
  );
  assert.deepEqual(buildThreadWorkbench([request], [job], [verified], 'agent')[0].allowedActions, [
    'attach-build-result',
  ]);
  const attached = attachThreadBuildJob(job, request, 'agent', at.attached);
  assert.deepEqual(
    buildThreadWorkbench([attached.request], [attached.job], [verified], 'agent')[0].allowedActions,
    ['submit-review'],
  );
  let review = submitThreadCandidateForReview(attached.request, 'agent', at.review);
  assert.deepEqual(
    buildThreadWorkbench([review], [attached.job], [verified], 'designer')[0].allowedActions,
    ['record-review-evidence', 'return-for-rework'],
  );
  for (const [gate, role] of [
    ['accessibility', 'designer'],
    ['designReview', 'designer'],
    ['securityReview', 'engineer'],
  ] as const) {
    review = recordThreadCandidateEvidence(
      review,
      gate,
      'passed',
      `report:${gate.toLowerCase()}:offer-callout`,
      role,
      at.review,
    );
  }
  assert.deepEqual(
    buildThreadWorkbench([review], [attached.job], [verified], 'governance')[0].allowedActions,
    ['approve'],
  );
});
