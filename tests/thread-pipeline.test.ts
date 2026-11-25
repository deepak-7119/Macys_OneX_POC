import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  NewThreadCandidate,
  NewThreadComponentRequest,
  ThreadComponentRequest,
} from '../platform/thread/pipeline/contracts.ts';
import {
  approveThreadCandidate,
  attachThreadCandidate,
  createThreadComponentRequest,
  recordThreadCandidateEvidence,
  returnThreadCandidateToWork,
  submitThreadCandidateForReview,
  validateThreadComponentRequest,
} from '../platform/thread/pipeline/workflow.ts';
import { validateThreadInventoryComponent } from '../platform/thread/inventory/validation.ts';

const times = {
  requested: '2026-11-17T09:00:00.000Z',
  candidate: '2026-11-17T09:05:00.000Z',
  tests: '2026-11-17T09:10:00.000Z',
  review: '2026-11-17T09:15:00.000Z',
  accessibility: '2026-11-17T09:20:00.000Z',
  design: '2026-11-17T09:25:00.000Z',
  security: '2026-11-17T09:30:00.000Z',
  approved: '2026-11-17T09:35:00.000Z',
};

function requestInput(): NewThreadComponentRequest {
  return {
    requestId: 'thread.request.status-timeline',
    objectId: 'thread.component.status-timeline',
    name: 'StatusTimeline',
    description: 'Presents a bounded sequence of labelled domain status events.',
    category: 'data-display',
    owner: { team: 'Thread Platform', issueLabel: 'thread:status-timeline' },
    source: {
      kind: 'figma',
      fileKey: 'figma-file-poc',
      componentKey: 'status-timeline-key',
      nodeId: '1234:5678',
    },
  };
}

function candidateInput(): NewThreadCandidate {
  return {
    version: '0.1.0',
    code: {
      framework: 'react',
      packageName: '@macys/thread-react',
      exportName: 'StatusTimeline',
      sourcePath: 'platform/thread/candidates/status-timeline.tsx',
    },
    figma: {
      status: 'mapped',
      fileKey: 'figma-file-poc',
      componentKey: 'status-timeline-key',
      nodeId: '1234:5678',
    },
  };
}

function candidateWithTests(): ThreadComponentRequest {
  const requested = createThreadComponentRequest(requestInput(), 'agent', times.requested);
  const candidate = attachThreadCandidate(requested, candidateInput(), 'agent', times.candidate);
  return recordThreadCandidateEvidence(
    candidate,
    'tests',
    'passed',
    'report:tests:status-timeline',
    'agent',
    times.tests,
  );
}

function completeReview(): ThreadComponentRequest {
  let review = submitThreadCandidateForReview(candidateWithTests(), 'agent', times.review);
  review = recordThreadCandidateEvidence(
    review,
    'accessibility',
    'passed',
    'report:a11y:status-timeline',
    'designer',
    times.accessibility,
  );
  review = recordThreadCandidateEvidence(
    review,
    'designReview',
    'passed',
    'review:design:status-timeline',
    'designer',
    times.design,
  );
  return recordThreadCandidateEvidence(
    review,
    'securityReview',
    'passed',
    'review:security:status-timeline',
    'engineer',
    times.security,
  );
}

test('agents can create a validated request for an inventory miss', () => {
  const input = requestInput();
  const request = createThreadComponentRequest(input, 'agent', times.requested);
  assert.equal(request.status, 'requested');
  assert.equal(request.requestedBy, 'agent');
  assert.equal(request.candidate, undefined);
  assert.deepEqual(validateThreadComponentRequest(request), request);
  assert.notStrictEqual(request.source, input.source);
});

test('requests reject existing inventory IDs, unsafe sources and unsupported fields', () => {
  assert.throws(
    () =>
      createThreadComponentRequest(
        {
          ...requestInput(),
          objectId: 'thread.component.data-table',
        },
        'agent',
        times.requested,
      ),
    /already exists/,
  );
  assert.throws(() =>
    createThreadComponentRequest(
      {
        ...requestInput(),
        source: {
          kind: 'application',
          appId: 'sample-app',
          sourcePath: '../outside/component.tsx',
        },
      },
      'agent',
      times.requested,
    ),
  );
  const request = createThreadComponentRequest(requestInput(), 'agent', times.requested);
  assert.throws(() => validateThreadComponentRequest({ ...request, executable: 'alert(1)' }));
});

test('agent-built candidates require matching source bindings and passed test evidence', () => {
  const request = createThreadComponentRequest(requestInput(), 'agent', times.requested);
  assert.throws(() =>
    attachThreadCandidate(
      request,
      { ...candidateInput(), executable: 'alert(1)' } as NewThreadCandidate,
      'agent',
      times.candidate,
    ),
  );
  assert.throws(() =>
    attachThreadCandidate(
      request,
      { ...candidateInput(), figma: { status: 'unmapped' } },
      'agent',
      times.candidate,
    ),
  );
  const candidate = attachThreadCandidate(request, candidateInput(), 'agent', times.candidate);
  assert.equal(candidate.status, 'candidate');
  assert.throws(
    () => submitThreadCandidateForReview(candidate, 'agent', times.review),
    /test evidence/,
  );
  const failed = recordThreadCandidateEvidence(
    candidate,
    'tests',
    'failed',
    'report:tests:failed',
    'agent',
    times.tests,
  );
  assert.throws(
    () => submitThreadCandidateForReview(failed, 'agent', times.review),
    /test evidence/,
  );
});

test('agents may submit tested candidates but cannot record human gates or approve', () => {
  const review = submitThreadCandidateForReview(candidateWithTests(), 'agent', times.review);
  assert.equal(review.status, 'review');
  assert.equal(review.candidate?.version.status, 'review');
  for (const gate of ['accessibility', 'designReview', 'securityReview'] as const) {
    assert.throws(
      () =>
        recordThreadCandidateEvidence(
          review,
          gate,
          'passed',
          `review:${gate}:forged`,
          'agent',
          times.accessibility,
        ),
      /cannot be recorded by agent/,
    );
  }
  assert.throws(
    () => approveThreadCandidate(completeReview(), 'agent', times.approved),
    /not allowed for agent/,
  );
});

test('only complete reviewed evidence produces an inventory-ready approved record', () => {
  const review = completeReview();
  const approved = approveThreadCandidate(review, 'governance', times.approved);
  assert.equal(review.status, 'review', 'workflow operations must not mutate their input');
  assert.equal(approved.request.status, 'approved');
  assert.equal(approved.request.approvedAt, times.approved);
  assert.equal(approved.component.currentVersion, '0.1.0');
  assert.equal(approved.component.versions[0].status, 'approved');
  assert.equal(approved.component.versions[0].approvedAt, times.approved);
  assert.doesNotThrow(() => validateThreadInventoryComponent(approved.component));
});

test('reviewers can return work while audit timestamps and evidence roles remain enforced', () => {
  const review = submitThreadCandidateForReview(candidateWithTests(), 'agent', times.review);
  const returned = returnThreadCandidateToWork(review, 'designer', times.accessibility);
  assert.equal(returned.status, 'candidate');
  assert.throws(() => returnThreadCandidateToWork(review, 'agent', times.accessibility));
  assert.throws(() =>
    recordThreadCandidateEvidence(
      review,
      'designReview',
      'passed',
      'review:design:old',
      'designer',
      times.requested,
    ),
  );

  const withDesign = recordThreadCandidateEvidence(
    review,
    'designReview',
    'passed',
    'review:design:valid',
    'designer',
    times.design,
  );
  withDesign.candidate!.evidence.designReview!.recordedBy = 'agent';
  assert.throws(() => validateThreadComponentRequest(withDesign), /not authorized/);
});

test('governance cannot approve incomplete review evidence', () => {
  const review = submitThreadCandidateForReview(candidateWithTests(), 'agent', times.review);
  assert.throws(
    () => approveThreadCandidate(review, 'governance', times.approved),
    /every quality gate/,
  );
});
