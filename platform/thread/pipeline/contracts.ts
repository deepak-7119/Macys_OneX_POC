import type {
  ThreadActorRole,
  ThreadCodeBinding,
  ThreadComponentCategory,
  ThreadComponentOwner,
  ThreadComponentVersion,
  ThreadFigmaBinding,
  ThreadObjectId,
  ThreadQualityGates,
  ThreadQualityResult,
} from '../inventory/contracts.ts';

export type ThreadRequestStatus = 'requested' | 'candidate' | 'review' | 'approved';
export type ThreadQualityGate = keyof ThreadQualityGates;
export type ThreadEvidenceResult = Exclude<ThreadQualityResult, 'pending'>;
export type ThreadRequestId = `thread.request.${string}`;

export type ThreadRequestSource =
  | {
      kind: 'figma';
      fileKey: string;
      componentKey: string;
      nodeId: string;
    }
  | {
      kind: 'application';
      appId: string;
      sourcePath: string;
    };

export interface ThreadCandidateEvidence {
  artifactId: string;
  recordedBy: ThreadActorRole;
  recordedAt: string;
}

export interface ThreadCandidateArtifact {
  version: ThreadComponentVersion;
  evidence: Partial<Record<ThreadQualityGate, ThreadCandidateEvidence>>;
}

export interface ThreadComponentRequest {
  requestId: ThreadRequestId;
  objectId: ThreadObjectId;
  name: string;
  description: string;
  category: ThreadComponentCategory;
  owner: ThreadComponentOwner;
  source: ThreadRequestSource;
  status: ThreadRequestStatus;
  candidate?: ThreadCandidateArtifact;
  requestedBy: ThreadActorRole;
  createdAt: string;
  updatedAt: string;
  approvedAt?: string;
}

export interface NewThreadComponentRequest {
  requestId: ThreadRequestId;
  objectId: ThreadObjectId;
  name: string;
  description: string;
  category: ThreadComponentCategory;
  owner: ThreadComponentOwner;
  source: ThreadRequestSource;
}

export interface NewThreadCandidate {
  version: string;
  code: ThreadCodeBinding;
  figma: ThreadFigmaBinding;
}

export interface ApprovedThreadCandidate {
  request: ThreadComponentRequest;
  component: import('../inventory/contracts.ts').ThreadInventoryComponent;
}
