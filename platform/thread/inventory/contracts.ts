export const threadLifecycleStatuses = [
  'requested',
  'candidate',
  'review',
  'approved',
  'deprecated',
  'retired',
] as const;

export type ThreadLifecycleStatus = (typeof threadLifecycleStatuses)[number];
export type ThreadActorRole = 'agent' | 'designer' | 'engineer' | 'governance';
export type ThreadObjectId = `thread.component.${string}`;

export type ThreadQualityResult = 'pending' | 'passed' | 'failed';

export interface ThreadQualityGates {
  tests: ThreadQualityResult;
  accessibility: ThreadQualityResult;
  designReview: ThreadQualityResult;
  securityReview: ThreadQualityResult;
}

export interface ThreadCodeBinding {
  framework: 'react';
  packageName: string;
  exportName: string;
  sourcePath: string;
}

export interface ThreadFigmaBinding {
  status: 'unmapped' | 'mapped' | 'verified';
  fileKey?: string;
  componentKey?: string;
  nodeId?: string;
}

export interface ThreadComponentVersion {
  version: string;
  status: ThreadLifecycleStatus;
  code: ThreadCodeBinding;
  figma: ThreadFigmaBinding;
  quality: ThreadQualityGates;
  createdAt: string;
  updatedAt: string;
  approvedAt?: string;
}

export interface ThreadComponentOwner {
  team: string;
  issueLabel: string;
}

export type ThreadComponentCategory =
  'primitive' | 'form' | 'data-display' | 'navigation' | 'feedback' | 'layout' | 'domain';

export interface ThreadInventoryComponent {
  objectId: ThreadObjectId;
  name: string;
  description: string;
  category: ThreadComponentCategory;
  owner: ThreadComponentOwner;
  currentVersion?: string;
  versions: ThreadComponentVersion[];
  createdAt: string;
  updatedAt: string;
}

export interface ThreadComponentReference {
  objectId: ThreadObjectId;
  version: string;
}
