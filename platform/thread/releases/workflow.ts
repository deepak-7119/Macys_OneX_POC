import type { ThreadActorRole, ThreadInventoryComponent } from '../inventory/contracts.ts';
import { assertThreadLifecycleTransition } from '../inventory/lifecycle.ts';
import {
  findThreadInventoryComponentByExport,
  getThreadInventoryComponent,
} from '../inventory/registry.ts';
import { validateThreadInventoryComponent } from '../inventory/validation.ts';
import type { ThreadArtifactRecord } from '../artifacts/contracts.ts';
import { validateThreadArtifact } from '../artifacts/validation.ts';
import type { ThreadBuildJob } from '../jobs/contracts.ts';
import { validateThreadBuildJob } from '../jobs/validation.ts';
import type { ThreadComponentRequest } from '../pipeline/contracts.ts';
import { validateThreadComponentRequest } from '../pipeline/workflow.ts';
import type {
  ThreadReleaseId,
  ThreadReleaseRecord,
  ThreadReleaseRollbackInput,
} from './contracts.ts';
import { validateThreadRelease } from './validation.ts';

function governance(actor: ThreadActorRole) {
  if (actor !== 'governance') throw new Error(`Thread release operation is not allowed for ${actor}.`);
}

function assertAfter(at: string, ...previous: string[]) {
  const parsed = Date.parse(at);
  if (Number.isNaN(parsed) || new Date(parsed).toISOString() !== at || previous.some((value) => at <= value))
    throw new Error('Thread release timestamp must advance beyond every source record.');
}

function componentFromRequest(request: ThreadComponentRequest): ThreadInventoryComponent {
  if (!request.candidate || request.status !== 'approved')
    throw new Error('A Thread release requires an approved component request.');
  return validateThreadInventoryComponent({
    objectId: request.objectId,
    name: request.name,
    description: request.description,
    category: request.category,
    owner: structuredClone(request.owner),
    currentVersion: request.candidate.version.version,
    versions: [structuredClone(request.candidate.version)],
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
  });
}

export function promoteThreadRelease(
  releaseId: ThreadReleaseId,
  requestSource: ThreadComponentRequest,
  jobSource: ThreadBuildJob,
  artifactSource: ThreadArtifactRecord,
  actor: ThreadActorRole,
  at: string,
): ThreadReleaseRecord {
  governance(actor);
  const request = validateThreadComponentRequest(requestSource);
  const job = validateThreadBuildJob(jobSource);
  const artifact = validateThreadArtifact(artifactSource);
  assertAfter(at, request.updatedAt, job.updatedAt, artifact.updatedAt);
  if (request.status !== 'approved' || !request.candidate)
    throw new Error('A Thread release requires an approved component request.');
  if (job.status !== 'attached') throw new Error('A Thread release requires an attached build job.');
  if (artifact.status !== 'verified') throw new Error('A Thread release requires a verified artifact.');
  if (
    request.requestId !== job.requestId ||
    request.objectId !== job.objectId ||
    artifact.jobId !== job.jobId ||
    artifact.requestId !== request.requestId ||
    artifact.objectId !== request.objectId
  )
    throw new Error('Thread release source identities do not match.');
  if (
    request.candidate.version.version !== artifact.package.version ||
    JSON.stringify(request.candidate.version.code) !== JSON.stringify(artifact.package.code)
  )
    throw new Error('Thread release package identity does not match the approved candidate.');
  if (
    getThreadInventoryComponent(request.objectId) ||
    findThreadInventoryComponentByExport(request.name)
  )
    throw new Error('The Thread inventory already reserves this component identity.');
  return validateThreadRelease({
    releaseId,
    requestId: request.requestId,
    jobId: job.jobId,
    artifactId: artifact.artifactId,
    status: 'active',
    component: componentFromRequest(request),
    artifactContent: structuredClone(artifact.content),
    promotedBy: 'governance',
    createdAt: at,
    updatedAt: at,
  });
}

export function rollbackThreadRelease(
  source: ThreadReleaseRecord,
  input: ThreadReleaseRollbackInput,
  actor: ThreadActorRole,
  at: string,
): ThreadReleaseRecord {
  governance(actor);
  const release = validateThreadRelease(source);
  assertAfter(at, release.updatedAt);
  if (release.status !== 'active') throw new Error('Only an active Thread release can be rolled back.');
  const current = release.component.versions.find(
    (item) => item.version === release.component.currentVersion,
  );
  if (!current) throw new Error('Thread release current version is missing.');
  assertThreadLifecycleTransition('approved', 'deprecated', actor, current.quality);
  current.status = 'deprecated';
  current.updatedAt = at;
  release.component.updatedAt = at;
  release.status = 'rolled-back';
  release.updatedAt = at;
  release.rollback = {
    reason: input.reason,
    evidenceId: input.evidenceId,
    recordedBy: 'governance',
    recordedAt: at,
  };
  return validateThreadRelease(release);
}
