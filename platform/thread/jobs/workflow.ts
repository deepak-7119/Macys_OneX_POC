import type { ThreadActorRole } from '../inventory/contracts.ts';
import type { ThreadComponentRequest } from '../pipeline/contracts.ts';
import {
  attachThreadCandidate,
  recordThreadCandidateEvidence,
  validateThreadComponentRequest,
} from '../pipeline/workflow.ts';
import type {
  AttachedThreadBuildResult,
  NewThreadBuildSubmission,
  ThreadBuildJob,
  ThreadBuildJobId,
} from './contracts.ts';
import { validateThreadBuildJob } from './validation.ts';

type BuildActor = Extract<ThreadActorRole, 'agent' | 'engineer'>;

function buildActor(actor: ThreadActorRole): BuildActor {
  if (actor !== 'agent' && actor !== 'engineer')
    throw new Error(`Thread build jobs are not allowed for ${actor}.`);
  return actor;
}

function assertAfter(at: string, previous: string) {
  if (at <= previous) throw new Error('Thread build job timestamp must advance.');
}

export function createThreadBuildJob(
  jobId: ThreadBuildJobId,
  source: ThreadComponentRequest,
  actor: ThreadActorRole,
  at: string,
): ThreadBuildJob {
  const request = validateThreadComponentRequest(source);
  const requestedBy = buildActor(actor);
  if (request.status !== 'requested')
    throw new Error('A Thread build job requires a requested component.');
  return validateThreadBuildJob({
    jobId,
    requestId: request.requestId,
    objectId: request.objectId,
    status: 'queued',
    framework: 'react',
    requestedBy,
    createdAt: at,
    updatedAt: at,
  });
}

export function claimThreadBuildJob(
  source: ThreadBuildJob,
  actor: ThreadActorRole,
  at: string,
): ThreadBuildJob {
  const job = validateThreadBuildJob(source);
  const claimedBy = buildActor(actor);
  assertAfter(at, job.updatedAt);
  if (job.status !== 'queued') throw new Error('Only a queued Thread build job can be claimed.');
  return validateThreadBuildJob({
    ...job,
    status: 'running',
    claimedBy,
    updatedAt: at,
  });
}

export function submitThreadBuildJob(
  source: ThreadBuildJob,
  requestSource: ThreadComponentRequest,
  submission: NewThreadBuildSubmission,
  actor: ThreadActorRole,
  at: string,
): ThreadBuildJob {
  const job = validateThreadBuildJob(source);
  const request = validateThreadComponentRequest(requestSource);
  const submittedBy = buildActor(actor);
  assertAfter(at, job.updatedAt);
  if (job.status !== 'running')
    throw new Error('Only a running Thread build job can submit a candidate.');
  if (job.claimedBy !== submittedBy)
    throw new Error('A Thread build job can only be submitted by its claiming role.');
  if (request.requestId !== job.requestId || request.objectId !== job.objectId)
    throw new Error('Thread build job and component request identities do not match.');

  const candidate = attachThreadCandidate(request, submission.candidate, submittedBy, at);
  recordThreadCandidateEvidence(
    candidate,
    'tests',
    submission.tests.result,
    submission.tests.artifactId,
    submittedBy,
    at,
  );
  return validateThreadBuildJob({
    ...job,
    status: 'candidate-ready',
    output: structuredClone(submission),
    submittedAt: at,
    updatedAt: at,
  });
}

export function attachThreadBuildJob(
  source: ThreadBuildJob,
  requestSource: ThreadComponentRequest,
  actor: ThreadActorRole,
  at: string,
): AttachedThreadBuildResult {
  const job = validateThreadBuildJob(source);
  const request = validateThreadComponentRequest(requestSource);
  const attachedBy = buildActor(actor);
  assertAfter(at, job.updatedAt);
  if (job.status !== 'candidate-ready' || !job.output)
    throw new Error('Only a candidate-ready Thread build job can be attached.');
  if (request.requestId !== job.requestId || request.objectId !== job.objectId)
    throw new Error('Thread build job and component request identities do not match.');

  let updatedRequest: ThreadComponentRequest;
  if (request.status === 'requested') {
    const evidenceActor = job.claimedBy ?? attachedBy;
    updatedRequest = attachThreadCandidate(request, job.output.candidate, evidenceActor, at);
    updatedRequest = recordThreadCandidateEvidence(
      updatedRequest,
      'tests',
      job.output.tests.result,
      job.output.tests.artifactId,
      evidenceActor,
      at,
    );
  } else if (
    request.status === 'candidate' &&
    request.candidate?.version.version === job.output.candidate.version &&
    JSON.stringify(request.candidate.version.code) === JSON.stringify(job.output.candidate.code) &&
    JSON.stringify(request.candidate.version.figma) ===
      JSON.stringify(job.output.candidate.figma) &&
    request.candidate.version.quality.tests === job.output.tests.result &&
    request.candidate.evidence.tests?.artifactId === job.output.tests.artifactId
  ) {
    // A previous attach may have committed the request before the job record.
    // Accepting that exact candidate makes the two-repository operation retry-safe.
    updatedRequest = request;
  } else {
    throw new Error('Thread build output can only attach to its requested component.');
  }
  return {
    request: updatedRequest,
    job: validateThreadBuildJob({
      ...job,
      status: 'attached',
      attachedAt: at,
      updatedAt: at,
    }),
  };
}
