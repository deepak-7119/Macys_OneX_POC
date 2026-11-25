import type { ThreadActorRole } from '../inventory/contracts.ts';
import type { ThreadArtifactRecord } from '../artifacts/contracts.ts';
import { validateThreadArtifact } from '../artifacts/validation.ts';
import type { ThreadComponentRequest } from '../pipeline/contracts.ts';
import { validateThreadComponentRequest } from '../pipeline/workflow.ts';
import type { ThreadBuildJob, ThreadWorkbenchAction, ThreadWorkbenchItem } from './contracts.ts';
import { validateThreadBuildJob } from './validation.ts';
import type { ThreadReleaseRecord } from '../releases/contracts.ts';
import { validateThreadRelease } from '../releases/validation.ts';

function isBuilder(actor: ThreadActorRole): boolean {
  return actor === 'agent' || actor === 'engineer';
}

function reviewComplete(request: ThreadComponentRequest): boolean {
  const evidence = request.candidate?.evidence;
  const quality = request.candidate?.version.quality;
  return (
    quality?.tests === 'passed' &&
    quality.accessibility === 'passed' &&
    quality.designReview === 'passed' &&
    quality.securityReview === 'passed' &&
    !!evidence?.tests &&
    !!evidence.accessibility &&
    !!evidence.designReview &&
    !!evidence.securityReview
  );
}

function actionsFor(
  request: ThreadComponentRequest,
  job: ThreadBuildJob | undefined,
  artifact: ThreadArtifactRecord | undefined,
  release: ThreadReleaseRecord | undefined,
  actor: ThreadActorRole,
): ThreadWorkbenchAction[] {
  if (release?.status === 'active' && actor === 'governance') return ['rollback-release'];
  if (request.status === 'approved' && !release && actor === 'governance')
    return ['promote-release'];
  if (request.status === 'requested' && isBuilder(actor)) {
    if (!job) return ['create-build-job'];
    if (job.status === 'queued') return ['claim-build-job'];
    if (job.status === 'running' && job.claimedBy === actor) return ['submit-build-result'];
    if (job.status === 'candidate-ready') {
      if (!artifact || artifact.status === 'rejected')
        return job.claimedBy === actor ? ['stage-artifact'] : [];
      if (artifact.status === 'staged') return actor === 'engineer' ? ['verify-artifact'] : [];
      if (artifact.status === 'verified') return ['attach-build-result'];
    }
  }
  if (request.status === 'candidate' && isBuilder(actor)) return ['submit-review'];
  if (request.status === 'review' && (actor === 'designer' || actor === 'engineer'))
    return ['record-review-evidence', 'return-for-rework'];
  if (request.status === 'review' && actor === 'governance' && reviewComplete(request))
    return ['approve'];
  return [];
}

export function buildThreadWorkbench(
  requestSources: ThreadComponentRequest[],
  jobSources: ThreadBuildJob[],
  artifactSources: ThreadArtifactRecord[],
  actor: ThreadActorRole,
  releaseSources: ThreadReleaseRecord[] = [],
): ThreadWorkbenchItem[] {
  const requests = requestSources.map(validateThreadComponentRequest);
  const jobs = jobSources.map(validateThreadBuildJob);
  const artifacts = artifactSources.map(validateThreadArtifact);
  const releases = releaseSources.map(validateThreadRelease);
  const jobsByRequest = new Map(jobs.map((job) => [job.requestId, job]));
  const releasesByRequest = new Map(releases.map((release) => [release.requestId, release]));
  return requests
    .map((request) => {
      const buildJob = jobsByRequest.get(request.requestId);
      const artifact = buildJob
        ? artifacts
            .filter((item) => item.jobId === buildJob.jobId)
            .sort(
              (left, right) =>
                left.createdAt.localeCompare(right.createdAt) ||
                left.artifactId.localeCompare(right.artifactId),
            )
            .at(-1)
        : undefined;
      const release = releasesByRequest.get(request.requestId);
      return {
        request,
        ...(buildJob ? { buildJob } : {}),
        ...(artifact ? { artifact } : {}),
        ...(release ? { release } : {}),
        allowedActions: actionsFor(request, buildJob, artifact, release, actor),
      };
    })
    .sort((left, right) =>
      left.request.createdAt === right.request.createdAt
        ? left.request.requestId.localeCompare(right.request.requestId)
        : left.request.createdAt.localeCompare(right.request.createdAt),
    );
}
