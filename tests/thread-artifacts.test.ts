import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type {
  NewThreadArtifact,
  ThreadArtifactVerification,
} from '../platform/thread/artifacts/contracts.ts';
import {
  FileThreadArtifactRepository,
  InMemoryThreadArtifactRepository,
  ThreadArtifactConflictError,
  ThreadArtifactDataError,
} from '../platform/thread/artifacts/repository.ts';
import { validateThreadArtifact } from '../platform/thread/artifacts/validation.ts';
import {
  stageThreadArtifact,
  verifyThreadArtifact,
} from '../platform/thread/artifacts/workflow.ts';
import {
  claimThreadBuildJob,
  createThreadBuildJob,
  submitThreadBuildJob,
} from '../platform/thread/jobs/workflow.ts';
import { createThreadComponentRequest } from '../platform/thread/pipeline/workflow.ts';

const times = {
  request: '2026-11-17T10:00:00.000Z',
  queued: '2026-11-17T10:01:00.000Z',
  running: '2026-11-17T10:02:00.000Z',
  submitted: '2026-11-17T10:03:00.000Z',
  staged: '2026-11-17T10:04:00.000Z',
  verified: '2026-11-17T10:05:00.000Z',
  replacement: '2026-11-17T10:06:00.000Z',
};

function readyJob() {
  const request = createThreadComponentRequest(
    {
      requestId: 'thread.request.promotion-banner',
      objectId: 'thread.component.promotion-banner',
      name: 'PromotionBanner',
      description: 'Presents a governed store promotion with bounded content.',
      category: 'data-display',
      owner: { team: 'Thread Platform', issueLabel: 'thread:promotion-banner' },
      source: {
        kind: 'application',
        appId: 'associate-communications',
        sourcePath: 'promotions/banner',
      },
    },
    'agent',
    times.request,
  );
  const queued = createThreadBuildJob(
    'thread.build-job.promotion-banner',
    request,
    'agent',
    times.queued,
  );
  const running = claimThreadBuildJob(queued, 'agent', times.running);
  return submitThreadBuildJob(
    running,
    request,
    {
      candidate: {
        version: '0.1.0',
        code: {
          framework: 'react',
          packageName: '@macys/thread-react',
          exportName: 'PromotionBanner',
          sourcePath: 'platform/thread/candidates/promotion-banner.tsx',
        },
        figma: { status: 'unmapped' },
      },
      tests: { result: 'passed', artifactId: 'report:tests:promotion-banner' },
    },
    'agent',
    times.submitted,
  );
}

function artifactInput(id = 'thread.artifact.promotion-banner'): NewThreadArtifact {
  return {
    artifactId: id as NewThreadArtifact['artifactId'],
    content: {
      sha256: 'b'.repeat(64),
      sizeBytes: 8192,
      mediaType: 'application/gzip',
    },
    sourceEvidence: {
      buildLogArtifactId: 'build:promotion-banner',
      sbomArtifactId: 'sbom:promotion-banner',
    },
  };
}

function verification(result: 'passed' | 'failed' = 'passed'): ThreadArtifactVerification {
  return {
    provenance: { result, artifactId: 'verify:provenance:promotion-banner' },
    dependencyAudit: { result: 'passed', artifactId: 'verify:dependencies:promotion-banner' },
    licenseReview: { result: 'passed', artifactId: 'verify:licenses:promotion-banner' },
  };
}

test('staging derives immutable package identity from the candidate-ready job', () => {
  const job = readyJob();
  const artifact = stageThreadArtifact(job, artifactInput(), 'agent', times.staged);
  assert.equal(artifact.status, 'staged');
  assert.equal(artifact.package.version, job.output?.candidate.version);
  assert.deepEqual(artifact.package.code, job.output?.candidate.code);
  assert.equal(artifact.content.sha256.length, 64);
  assert.deepEqual(validateThreadArtifact(artifact), artifact);
  assert.equal('bytes' in artifact.content, false);
});

test('only the claiming build role can stage a bounded non-executable manifest', () => {
  const job = readyJob();
  assert.throws(
    () => stageThreadArtifact(job, artifactInput(), 'engineer', times.staged),
    /claiming/,
  );
  assert.throws(
    () => stageThreadArtifact(job, artifactInput(), 'designer', times.staged),
    /not allowed/,
  );
  assert.throws(() =>
    stageThreadArtifact(
      job,
      {
        ...artifactInput(),
        content: { ...artifactInput().content, sha256: 'not-a-digest' },
      },
      'agent',
      times.staged,
    ),
  );
  const artifact = stageThreadArtifact(job, artifactInput(), 'agent', times.staged);
  assert.throws(() => validateThreadArtifact({ ...artifact, executable: 'alert(1)' }));
});

test('engineer policy evidence verifies all-pass manifests and records failed manifests as rejected', () => {
  const staged = stageThreadArtifact(readyJob(), artifactInput(), 'agent', times.staged);
  assert.throws(
    () => verifyThreadArtifact(staged, verification(), 'agent', times.verified),
    /not allowed/,
  );
  const verified = verifyThreadArtifact(staged, verification(), 'engineer', times.verified);
  assert.equal(verified.status, 'verified');
  assert.equal(verified.verifiedAt, times.verified);
  assert.ok(
    Object.values(verified.policyEvidence).every((item) => item?.recordedBy === 'engineer'),
  );

  const rejected = verifyThreadArtifact(staged, verification('failed'), 'engineer', times.verified);
  assert.equal(rejected.status, 'rejected');
  assert.equal(rejected.rejectedAt, times.verified);
  assert.throws(() =>
    verifyThreadArtifact(rejected, verification(), 'engineer', times.replacement),
  );
});

test('repository preserves rejected history, permits a replacement and freezes verified identity', async () => {
  const repository = new InMemoryThreadArtifactRepository();
  const job = readyJob();
  const staged = stageThreadArtifact(job, artifactInput(), 'agent', times.staged);
  await repository.save(staged);
  await assert.rejects(
    () =>
      repository.save(
        stageThreadArtifact(
          job,
          artifactInput('thread.artifact.promotion-banner-second'),
          'agent',
          times.verified,
        ),
      ),
    ThreadArtifactConflictError,
  );
  const rejected = verifyThreadArtifact(staged, verification('failed'), 'engineer', times.verified);
  await repository.save(rejected, staged.updatedAt);
  const replacement = stageThreadArtifact(
    job,
    artifactInput('thread.artifact.promotion-banner-second'),
    'agent',
    times.replacement,
  );
  await repository.save(replacement);
  assert.equal((await repository.listByJob(job.jobId)).length, 2);

  await assert.rejects(
    () =>
      repository.save(
        {
          ...replacement,
          content: { ...replacement.content, sha256: 'c'.repeat(64) },
          updatedAt: '2026-11-17T10:07:00.000Z',
        },
        replacement.updatedAt,
      ),
    /immutable/,
  );
  const verified = verifyThreadArtifact(
    replacement,
    verification(),
    'engineer',
    '2026-11-17T10:07:00.000Z',
  );
  await repository.save(verified, replacement.updatedAt);
  assert.equal((await repository.getVerifiedByJob(job.jobId))?.artifactId, replacement.artifactId);
  await assert.rejects(
    () =>
      repository.save(
        stageThreadArtifact(
          job,
          artifactInput('thread.artifact.promotion-banner-third'),
          'agent',
          '2026-11-17T10:08:00.000Z',
        ),
      ),
    ThreadArtifactConflictError,
  );
});

test('file artifact repository persists verified manifests and fails closed on corrupt data', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'overlock-artifacts-'));
  const path = join(directory, 'artifacts.json');
  const repository = new FileThreadArtifactRepository(path);
  const staged = stageThreadArtifact(readyJob(), artifactInput(), 'agent', times.staged);
  await repository.save(staged);
  const verified = verifyThreadArtifact(staged, verification(), 'engineer', times.verified);
  await repository.save(verified, staged.updatedAt);
  assert.deepEqual(await new FileThreadArtifactRepository(path).get(verified.artifactId), verified);

  const corruptPath = join(directory, 'corrupt.json');
  await writeFile(corruptPath, '{"schemaVersion":1,"artifacts":[{"secret":"no"}]}');
  await assert.rejects(
    () => new FileThreadArtifactRepository(corruptPath).list(),
    ThreadArtifactDataError,
  );
});
