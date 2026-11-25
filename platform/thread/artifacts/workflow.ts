import type { ThreadActorRole } from '../inventory/contracts.ts';
import type { ThreadBuildJob } from '../jobs/contracts.ts';
import { validateThreadBuildJob } from '../jobs/validation.ts';
import type {
  NewThreadArtifact,
  ThreadArtifactRecord,
  ThreadArtifactVerification,
} from './contracts.ts';
import { validateThreadArtifact } from './validation.ts';

function buildActor(actor: ThreadActorRole): Extract<ThreadActorRole, 'agent' | 'engineer'> {
  if (actor !== 'agent' && actor !== 'engineer')
    throw new Error(`Thread artifact staging is not allowed for ${actor}.`);
  return actor;
}

function assertAfter(at: string, previous: string) {
  if (at <= previous) throw new Error('Thread artifact timestamp must advance.');
}

export function stageThreadArtifact(
  jobSource: ThreadBuildJob,
  input: NewThreadArtifact,
  actor: ThreadActorRole,
  at: string,
): ThreadArtifactRecord {
  const job = validateThreadBuildJob(jobSource);
  const stagedBy = buildActor(actor);
  if (job.status !== 'candidate-ready' || !job.output)
    throw new Error('A Thread artifact requires a candidate-ready build job.');
  if (job.claimedBy !== stagedBy)
    throw new Error('A Thread artifact can only be staged by the job claiming role.');
  return validateThreadArtifact({
    artifactId: input.artifactId,
    jobId: job.jobId,
    requestId: job.requestId,
    objectId: job.objectId,
    status: 'staged',
    package: {
      version: job.output.candidate.version,
      code: structuredClone(job.output.candidate.code),
    },
    content: structuredClone(input.content),
    sourceEvidence: structuredClone(input.sourceEvidence),
    policyEvidence: {},
    stagedBy,
    createdAt: at,
    updatedAt: at,
  });
}

export function verifyThreadArtifact(
  artifactSource: ThreadArtifactRecord,
  input: ThreadArtifactVerification,
  actor: ThreadActorRole,
  at: string,
): ThreadArtifactRecord {
  const artifact = validateThreadArtifact(artifactSource);
  if (actor !== 'engineer')
    throw new Error(`Thread artifact verification is not allowed for ${actor}.`);
  assertAfter(at, artifact.updatedAt);
  if (artifact.status !== 'staged')
    throw new Error('Only a staged Thread artifact can be verified.');
  const policyEvidence = Object.fromEntries(
    Object.entries(input).map(([gate, evidence]) => [
      gate,
      { ...evidence, recordedBy: 'engineer', recordedAt: at },
    ]),
  );
  const passed = Object.values(input).every((evidence) => evidence.result === 'passed');
  return validateThreadArtifact({
    ...artifact,
    status: passed ? 'verified' : 'rejected',
    policyEvidence,
    updatedAt: at,
    ...(passed ? { verifiedAt: at } : { rejectedAt: at }),
  });
}
