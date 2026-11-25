import type { ThreadActorRole, ThreadCodeBinding, ThreadObjectId } from '../inventory/contracts.ts';
import type { ThreadEvidenceResult, ThreadRequestId } from '../pipeline/contracts.ts';
import type { ThreadBuildJobId } from '../jobs/contracts.ts';

export type ThreadArtifactId = `thread.artifact.${string}`;
export type ThreadArtifactStatus = 'staged' | 'verified' | 'rejected';
export type ThreadArtifactPolicyGate = 'provenance' | 'dependencyAudit' | 'licenseReview';

export interface ThreadArtifactContent {
  sha256: string;
  sizeBytes: number;
  mediaType: 'application/gzip';
}

export interface ThreadArtifactSourceEvidence {
  buildLogArtifactId: string;
  sbomArtifactId: string;
}

export interface ThreadArtifactPackage {
  version: string;
  code: ThreadCodeBinding;
}

export interface ThreadArtifactPolicyEvidence {
  result: ThreadEvidenceResult;
  artifactId: string;
  recordedBy: Extract<ThreadActorRole, 'engineer'>;
  recordedAt: string;
}

export interface ThreadArtifactRecord {
  artifactId: ThreadArtifactId;
  jobId: ThreadBuildJobId;
  requestId: ThreadRequestId;
  objectId: ThreadObjectId;
  status: ThreadArtifactStatus;
  package: ThreadArtifactPackage;
  content: ThreadArtifactContent;
  sourceEvidence: ThreadArtifactSourceEvidence;
  policyEvidence: Partial<Record<ThreadArtifactPolicyGate, ThreadArtifactPolicyEvidence>>;
  stagedBy: Extract<ThreadActorRole, 'agent' | 'engineer'>;
  createdAt: string;
  updatedAt: string;
  verifiedAt?: string;
  rejectedAt?: string;
}

export interface NewThreadArtifact {
  artifactId: ThreadArtifactId;
  content: ThreadArtifactContent;
  sourceEvidence: ThreadArtifactSourceEvidence;
}

export type ThreadArtifactVerification = Record<
  ThreadArtifactPolicyGate,
  { result: ThreadEvidenceResult; artifactId: string }
>;
