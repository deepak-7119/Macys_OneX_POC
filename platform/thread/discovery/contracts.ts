import type { ThreadComponentReference, ThreadLifecycleStatus } from '../inventory/contracts.ts';
import type { NewThreadComponentRequest, ThreadComponentRequest } from '../pipeline/contracts.ts';

export type ThreadDiscoveryDecision = 'reuse' | 'review-alternatives' | 'inventory-gap';
export type ThreadDiscoverySignal =
  'object-id' | 'export-name' | 'name-token' | 'description-token' | 'category';

export interface ThreadDiscoveryMatch {
  reference: ThreadComponentReference;
  name: string;
  category: NewThreadComponentRequest['category'];
  status: ThreadLifecycleStatus;
  adoptionState: 'available' | 'blocked';
  score: number;
  signals: ThreadDiscoverySignal[];
}

export interface ThreadDiscoveryResult {
  requirement: NewThreadComponentRequest;
  decision: ThreadDiscoveryDecision;
  explanation: string;
  canOpenRequest: boolean;
  exactMatch?: ThreadDiscoveryMatch;
  alternatives: ThreadDiscoveryMatch[];
}

export interface ThreadDiscoveryRequestResult {
  discovery: ThreadDiscoveryResult;
  request: ThreadComponentRequest | null;
}
