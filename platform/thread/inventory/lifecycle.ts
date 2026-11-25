import type { ThreadActorRole, ThreadLifecycleStatus, ThreadQualityGates } from './contracts.ts';
import { qualityGatesPassed } from './validation.ts';

const transitions: Record<
  ThreadLifecycleStatus,
  Partial<Record<ThreadLifecycleStatus, readonly ThreadActorRole[]>>
> = {
  requested: { candidate: ['agent', 'engineer'] },
  candidate: { review: ['agent', 'engineer'] },
  review: {
    candidate: ['designer', 'engineer', 'governance'],
    approved: ['governance'],
  },
  approved: { deprecated: ['governance'] },
  deprecated: { retired: ['governance'] },
  retired: {},
};

export function assertThreadLifecycleTransition(
  from: ThreadLifecycleStatus,
  to: ThreadLifecycleStatus,
  actor: ThreadActorRole,
  quality: ThreadQualityGates,
): void {
  const roles = transitions[from][to];
  if (!roles?.includes(actor))
    throw new Error(`Thread lifecycle transition ${from} -> ${to} is not allowed for ${actor}.`);
  if (to === 'approved' && !qualityGatesPassed(quality))
    throw new Error('Thread approval requires every quality gate to pass.');
}

export function allowedThreadTransitions(
  from: ThreadLifecycleStatus,
  actor: ThreadActorRole,
): ThreadLifecycleStatus[] {
  return Object.entries(transitions[from])
    .filter(([, roles]) => roles?.includes(actor))
    .map(([status]) => status as ThreadLifecycleStatus);
}
