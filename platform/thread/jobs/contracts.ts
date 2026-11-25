import type { ThreadActorRole } from '../inventory/contracts.ts';
import type {
  NewThreadCandidate,
  ThreadComponentRequest,
  ThreadEvidenceResult,
  ThreadRequestId,
} from '../pipeline/contracts.ts';
import type { ThreadArtifactRecord } from '../artifacts/contracts.ts';
import type { ThreadReleaseRecord } from '../releases/contracts.ts';

export type ThreadBuildJobId = `thread.build-job.${string}`;
export type ThreadBuildJobStatus = 'queued' | 'running' | 'candidate-ready' | 'attached';

export interface ThreadBuildTestEvidence {
  result: ThreadEvidenceResult;
  artifactId: string;
}

export interface ThreadBuildOutput {
  candidate: NewThreadCandidate;
  tests: ThreadBuildTestEvidence;
}

export interface ThreadBuildJob {
  jobId: ThreadBuildJobId;
  requestId: ThreadRequestId;
  objectId: ThreadComponentRequest['objectId'];
  status: ThreadBuildJobStatus;
  framework: 'react';
  requestedBy: Extract<ThreadActorRole, 'agent' | 'engineer'>;
  claimedBy?: Extract<ThreadActorRole, 'agent' | 'engineer'>;
  output?: ThreadBuildOutput;
  createdAt: string;
  updatedAt: string;
  submittedAt?: string;
  attachedAt?: string;
}

export interface NewThreadBuildSubmission {
  candidate: NewThreadCandidate;
  tests: ThreadBuildTestEvidence;
}

export interface AttachedThreadBuildResult {
  job: ThreadBuildJob;
  request: ThreadComponentRequest;
}

export type ThreadWorkbenchAction =
  | 'create-build-job'
  | 'claim-build-job'
  | 'submit-build-result'
  | 'stage-artifact'
  | 'verify-artifact'
  | 'attach-build-result'
  | 'submit-review'
  | 'record-review-evidence'
  | 'return-for-rework'
  | 'approve'
  | 'promote-release'
  | 'rollback-release';

export interface ThreadWorkbenchItem {
  request: ThreadComponentRequest;
  buildJob?: ThreadBuildJob;
  artifact?: ThreadArtifactRecord;
  release?: ThreadReleaseRecord;
  allowedActions: ThreadWorkbenchAction[];
}
