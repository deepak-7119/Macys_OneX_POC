import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { InMemoryThreadArtifactRepository } from '../platform/thread/artifacts/repository.ts';
import { stageThreadArtifact, verifyThreadArtifact } from '../platform/thread/artifacts/workflow.ts';
import { discoverThreadComponents } from '../platform/thread/discovery/service.ts';
import { buildThreadWorkbench } from '../platform/thread/jobs/workbench.ts';
import {
  attachThreadBuildJob,
  claimThreadBuildJob,
  createThreadBuildJob,
  submitThreadBuildJob,
} from '../platform/thread/jobs/workflow.ts';
import {
  approveThreadCandidate,
  createThreadComponentRequest,
  recordThreadCandidateEvidence,
  submitThreadCandidateForReview,
} from '../platform/thread/pipeline/workflow.ts';
import { listThreadInventoryCatalog } from '../platform/thread/releases/catalog.ts';
import {
  FileThreadReleaseRepository,
  InMemoryThreadReleaseRepository,
  ThreadReleaseConflictError,
  ThreadReleaseDataError,
} from '../platform/thread/releases/repository.ts';
import { promoteThreadRelease, rollbackThreadRelease } from '../platform/thread/releases/workflow.ts';

const at = (minute: number) => `2026-11-17T14:${String(minute).padStart(2, '0')}:00.000Z`;

function approvedSources() {
  const request = createThreadComponentRequest(
    {
      requestId: 'thread.request.release-promotion-banner',
      objectId: 'thread.component.release-promotion-banner',
      name: 'ReleasePromotionBanner',
      description: 'Presents an approved promotion after governed release.',
      category: 'domain',
      owner: { team: 'Thread Platform', issueLabel: 'thread:release-promotion-banner' },
      source: {
        kind: 'figma',
        fileKey: 'mockRetailDesign',
        componentKey: 'releasePromotionBanner',
        nodeId: '90:22',
      },
    },
    'agent',
    at(0),
  );
  const queued = createThreadBuildJob('thread.build-job.release-promotion-banner', request, 'agent', at(1));
  const running = claimThreadBuildJob(queued, 'agent', at(2));
  const ready = submitThreadBuildJob(
    running,
    request,
    {
      candidate: {
        version: '1.0.0',
        code: {
          framework: 'react',
          packageName: '@macys/thread-react',
          exportName: 'ReleasePromotionBanner',
          sourcePath: 'platform/thread/candidates/release-promotion-banner.tsx',
        },
        figma: {
          status: 'mapped',
          fileKey: 'mockRetailDesign',
          componentKey: 'releasePromotionBanner',
          nodeId: '90:22',
        },
      },
      tests: { result: 'passed', artifactId: 'report:tests:release-promotion-banner' },
    },
    'agent',
    at(3),
  );
  const staged = stageThreadArtifact(
    ready,
    {
      artifactId: 'thread.artifact.release-promotion-banner',
      content: { sha256: 'd'.repeat(64), sizeBytes: 2048, mediaType: 'application/gzip' },
      sourceEvidence: {
        buildLogArtifactId: 'build:release-promotion-banner',
        sbomArtifactId: 'sbom:release-promotion-banner',
      },
    },
    'agent',
    at(4),
  );
  const artifact = verifyThreadArtifact(
    staged,
    {
      provenance: { result: 'passed', artifactId: 'verify:provenance:release-promotion-banner' },
      dependencyAudit: { result: 'passed', artifactId: 'verify:dependencies:release-promotion-banner' },
      licenseReview: { result: 'passed', artifactId: 'verify:licenses:release-promotion-banner' },
    },
    'engineer',
    at(5),
  );
  const attached = attachThreadBuildJob(ready, request, 'agent', at(6));
  let reviewed = submitThreadCandidateForReview(attached.request, 'agent', at(7));
  reviewed = recordThreadCandidateEvidence(
    reviewed,
    'accessibility',
    'passed',
    'review:accessibility:release-promotion-banner',
    'designer',
    at(8),
  );
  reviewed = recordThreadCandidateEvidence(
    reviewed,
    'designReview',
    'passed',
    'review:design:release-promotion-banner',
    'designer',
    at(9),
  );
  reviewed = recordThreadCandidateEvidence(
    reviewed,
    'securityReview',
    'passed',
    'review:security:release-promotion-banner',
    'engineer',
    at(10),
  );
  const approved = approveThreadCandidate(reviewed, 'governance', at(11)).request;
  return { request: approved, job: attached.job, artifact };
}

function requirement() {
  return {
    requestId: 'thread.request.later-release-promotion-banner' as const,
    objectId: 'thread.component.release-promotion-banner' as const,
    name: 'ReleasePromotionBanner',
    description: 'Presents an approved promotion after governed release.',
    category: 'domain' as const,
    owner: { team: 'Thread Platform', issueLabel: 'thread:later-release-promotion-banner' },
    source: { kind: 'application' as const, appId: 'later-app', sourcePath: 'offers/release-banner' },
  };
}

test('governance promotes only the exact approved request, attached job and verified artifact', () => {
  const source = approvedSources();
  assert.throws(
    () => promoteThreadRelease('thread.release.promotion-banner', source.request, source.job, source.artifact, 'agent', at(12)),
    /not allowed/,
  );
  const release = promoteThreadRelease(
    'thread.release.promotion-banner',
    source.request,
    source.job,
    source.artifact,
    'governance',
    at(12),
  );
  assert.equal(release.status, 'active');
  assert.equal(release.component.currentVersion, '1.0.0');
  assert.equal(release.component.versions[0].status, 'approved');
  assert.equal(release.artifactContent.sha256, source.artifact.content.sha256);
});

test('promoted inventory produces exact reuse and rollback makes the same identity blocked', async () => {
  const source = approvedSources();
  const repository = new InMemoryThreadReleaseRepository();
  const release = promoteThreadRelease(
    'thread.release.promotion-banner', source.request, source.job, source.artifact, 'governance', at(12),
  );
  await repository.save(release);
  assert.equal(
    discoverThreadComponents(requirement(), await listThreadInventoryCatalog(repository)).decision,
    'reuse',
  );
  const rolledBack = rollbackThreadRelease(
    release,
    { reason: 'Rollback after a controlled compatibility finding.', evidenceId: 'rollback:compatibility:release-banner' },
    'governance',
    at(13),
  );
  await repository.save(rolledBack, release.updatedAt);
  const discovery = discoverThreadComponents(requirement(), await listThreadInventoryCatalog(repository));
  assert.equal(discovery.decision, 'review-alternatives');
  assert.equal(discovery.exactMatch?.status, 'deprecated');
  assert.equal(discovery.canOpenRequest, false);
});

test('release repository freezes source and package identity and preserves rollback evidence', async () => {
  const source = approvedSources();
  const repository = new InMemoryThreadReleaseRepository();
  const release = promoteThreadRelease(
    'thread.release.promotion-banner', source.request, source.job, source.artifact, 'governance', at(12),
  );
  await repository.save(release);
  await assert.rejects(
    () => repository.save({ ...release, artifactContent: { ...release.artifactContent, sha256: 'e'.repeat(64) }, updatedAt: at(13) }, release.updatedAt),
    /immutable/,
  );
  await assert.rejects(
    () => repository.save({ ...release, releaseId: 'thread.release.other-promotion-banner' }),
    ThreadReleaseConflictError,
  );
  const rolledBack = rollbackThreadRelease(
    release,
    { reason: 'Rollback remains visible for audit and remediation.', evidenceId: 'rollback:audit:release-banner' },
    'governance',
    at(13),
  );
  await repository.save(rolledBack, release.updatedAt);
  assert.equal((await repository.get(release.releaseId))?.rollback?.recordedBy, 'governance');
});

test('governance workbench exposes promotion and rollback as the only valid release actions', () => {
  const source = approvedSources();
  const release = promoteThreadRelease(
    'thread.release.promotion-banner', source.request, source.job, source.artifact, 'governance', at(12),
  );
  assert.deepEqual(
    buildThreadWorkbench([source.request], [source.job], [source.artifact], 'governance')[0].allowedActions,
    ['promote-release'],
  );
  assert.deepEqual(
    buildThreadWorkbench([source.request], [source.job], [source.artifact], 'governance', [release])[0].allowedActions,
    ['rollback-release'],
  );
});

test('file release repository persists active releases and fails closed on corrupt data', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'overlock-releases-'));
  const path = join(directory, 'releases.json');
  const source = approvedSources();
  const release = promoteThreadRelease(
    'thread.release.promotion-banner', source.request, source.job, source.artifact, 'governance', at(12),
  );
  await new FileThreadReleaseRepository(path).save(release);
  assert.deepEqual(await new FileThreadReleaseRepository(path).get(release.releaseId), release);
  const corrupt = join(directory, 'corrupt.json');
  await writeFile(corrupt, '{"schemaVersion":1,"releases":[{"secret":"no"}]}');
  await assert.rejects(() => new FileThreadReleaseRepository(corrupt).list(), ThreadReleaseDataError);
});
