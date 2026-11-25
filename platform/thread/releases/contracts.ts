import type { ThreadActorRole, ThreadInventoryComponent } from '../inventory/contracts.ts';
import type { ThreadArtifactContent, ThreadArtifactId } from '../artifacts/contracts.ts';
import type { ThreadBuildJobId } from '../jobs/contracts.ts';
import type { ThreadRequestId } from '../pipeline/contracts.ts';

export type ThreadReleaseId = `thread.release.${string}`;
export type ThreadReleaseStatus = 'active' | 'rolled-back';

export interface ThreadReleaseRollback {
  reason: string;
  evidenceId: string;
  recordedBy: Extract<ThreadActorRole, 'governance'>;
  recordedAt: string;
}

export interface ThreadReleaseRecord {
  releaseId: ThreadReleaseId;
  requestId: ThreadRequestId;
  jobId: ThreadBuildJobId;
  artifactId: ThreadArtifactId;
  status: ThreadReleaseStatus;
  component: ThreadInventoryComponent;
  artifactContent: ThreadArtifactContent;
  promotedBy: Extract<ThreadActorRole, 'governance'>;
  createdAt: string;
  updatedAt: string;
  rollback?: ThreadReleaseRollback;
}

export interface NewThreadRelease {
  releaseId: ThreadReleaseId;
}

export interface ThreadReleaseRollbackInput {
  reason: string;
  evidenceId: string;
}
