import type { ThreadActorRole } from '../inventory/contracts.ts';
import type { ThreadArtifactId } from '../artifacts/contracts.ts';
import type { ThreadBuildJobId, NewThreadBuildSubmission } from '../jobs/contracts.ts';
import type { NewThreadComponentRequest, ThreadRequestId } from '../pipeline/contracts.ts';

export type ThreadAutomationRunId = `thread.adapter-run.${string}`;
export type ThreadAutomationCorrelationId = `thread.correlation.${string}`;
export type ThreadAutomationFixtureId = 'inventory-button' | 'figma-promotion-banner';
export type ThreadAutomationRunStatus = 'running' | 'completed' | 'failed';
export type ThreadAutomationOutcome = 'inventory-resolved' | 'artifact-staged';

export interface NewThreadAutomationRun {
  runId: ThreadAutomationRunId;
  fixtureId: ThreadAutomationFixtureId;
}

export interface ThreadAutomationFailure {
  code: 'adapter-failed';
  message: string;
}

export interface ThreadAutomationRun {
  runId: ThreadAutomationRunId;
  correlationId: ThreadAutomationCorrelationId;
  fixtureId: ThreadAutomationFixtureId;
  sourceProvider: 'mock-figma';
  status: ThreadAutomationRunStatus;
  initiatedBy: Extract<ThreadActorRole, 'agent' | 'engineer'>;
  adapters: {
    designSource: string;
    componentBuilder: string;
    artifactInspector: string;
  };
  discoveryDecision?: 'reuse' | 'review-alternatives' | 'inventory-gap';
  outcome?: ThreadAutomationOutcome;
  requestId?: ThreadRequestId;
  jobId?: ThreadBuildJobId;
  artifactId?: ThreadArtifactId;
  failure?: ThreadAutomationFailure;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface ThreadDesignSourceResult {
  requirement: NewThreadComponentRequest;
  artifactId: ThreadArtifactId;
}

export interface ThreadDesignSourceAdapter {
  readonly id: string;
  resolve(fixtureId: ThreadAutomationFixtureId): Promise<ThreadDesignSourceResult>;
}

export interface ThreadBuilderResult {
  submission: NewThreadBuildSubmission;
  sourceText: string;
}

export interface ThreadComponentBuilderAdapter {
  readonly id: string;
  build(source: ThreadDesignSourceResult): Promise<ThreadBuilderResult>;
}

export interface ThreadInspectedArtifact {
  content: {
    sha256: string;
    sizeBytes: number;
    mediaType: 'application/gzip';
  };
  sourceEvidence: {
    buildLogArtifactId: string;
    sbomArtifactId: string;
  };
}

export interface ThreadArtifactInspectorAdapter {
  readonly id: string;
  inspect(source: ThreadDesignSourceResult, build: ThreadBuilderResult): Promise<ThreadInspectedArtifact>;
}

export interface ThreadAutomationAdapters {
  designSource: ThreadDesignSourceAdapter;
  componentBuilder: ThreadComponentBuilderAdapter;
  artifactInspector: ThreadArtifactInspectorAdapter;
}

export interface ThreadAutomationExecution {
  run: ThreadAutomationRun;
  replayed: boolean;
}
