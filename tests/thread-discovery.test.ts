import assert from 'node:assert/strict';
import test from 'node:test';
import type { ThreadInventoryComponent } from '../platform/thread/inventory/contracts.ts';
import { getThreadInventoryComponent } from '../platform/thread/inventory/registry.ts';
import { validateThreadInventoryComponent } from '../platform/thread/inventory/validation.ts';
import type {
  NewThreadComponentRequest,
  ThreadComponentRequest,
} from '../platform/thread/pipeline/contracts.ts';
import { createThreadComponentRequest } from '../platform/thread/pipeline/workflow.ts';
import {
  discoverThreadComponents,
  findDuplicateThreadRequest,
} from '../platform/thread/discovery/service.ts';

function requirement(
  overrides: Partial<NewThreadComponentRequest> = {},
): NewThreadComponentRequest {
  return {
    requestId: 'thread.request.status-timeline-discovery',
    objectId: 'thread.component.status-timeline-discovery',
    name: 'StatusTimelineDiscovery',
    description: 'Displays an ordered sequence of lifecycle events and their status.',
    category: 'domain',
    owner: { team: 'Thread Platform', issueLabel: 'thread:status-timeline' },
    source: {
      kind: 'figma',
      fileKey: 'figma-file-poc',
      componentKey: 'status-timeline-key',
      nodeId: '1234:5678',
    },
    ...overrides,
  };
}

function approvedButton(): ThreadInventoryComponent {
  const component = getThreadInventoryComponent('thread.component.button')!;
  component.currentVersion = '1.0.0';
  component.updatedAt = '2026-11-17T01:00:00.000Z';
  component.versions[0] = {
    ...component.versions[0],
    status: 'approved',
    quality: {
      tests: 'passed',
      accessibility: 'passed',
      designReview: 'passed',
      securityReview: 'passed',
    },
    updatedAt: '2026-11-17T01:00:00.000Z',
    approvedAt: '2026-11-17T01:00:00.000Z',
  };
  return validateThreadInventoryComponent(component);
}

test('exact reviewed inventory components are found but blocked for new adoption', () => {
  const result = discoverThreadComponents(
    requirement({
      objectId: 'thread.component.button',
      name: 'Button',
      description: 'Shared button primitive.',
      category: 'primitive',
    }),
  );
  assert.equal(result.decision, 'review-alternatives');
  assert.equal(result.canOpenRequest, false);
  assert.equal(result.exactMatch?.reference.objectId, 'thread.component.button');
  assert.equal(result.exactMatch?.status, 'review');
  assert.equal(result.exactMatch?.adoptionState, 'blocked');
  assert.deepEqual(result.exactMatch?.signals.slice(0, 2), ['object-id', 'export-name']);
});

test('only an exact approved current version produces a reusable reference', () => {
  const input = requirement({
    objectId: 'thread.component.button',
    name: 'Button',
    description: 'Shared button primitive.',
    category: 'primitive',
  });
  const result = discoverThreadComponents(input, [approvedButton()]);
  assert.equal(result.decision, 'reuse');
  assert.equal(result.exactMatch?.adoptionState, 'available');
  assert.deepEqual(result.exactMatch?.reference, {
    objectId: 'thread.component.button',
    version: '1.0.0',
  });
  assert.equal(result.canOpenRequest, false);
});

test('related lexical matches are explainable alternatives, not automatic reuse', () => {
  const input = requirement({
    requestId: 'thread.request.data-grid-discovery',
    objectId: 'thread.component.data-grid-discovery',
    name: 'DataGridDiscovery',
    description: 'Accessible tabular results with columns and row actions.',
    category: 'data-display',
  });
  const first = discoverThreadComponents(input);
  const second = discoverThreadComponents(input);
  assert.deepEqual(second, first, 'matching and ordering must be deterministic');
  assert.equal(first.decision, 'review-alternatives');
  assert.equal(first.alternatives[0]?.reference.objectId, 'thread.component.data-table');
  assert.ok(first.alternatives[0]?.signals.includes('name-token'));
  assert.ok(first.alternatives[0]?.signals.includes('description-token'));
});

test('a genuine inventory gap may open a request and preserves traceable source IDs', () => {
  const input = requirement();
  const result = discoverThreadComponents(input);
  assert.equal(result.decision, 'inventory-gap');
  assert.equal(result.canOpenRequest, true);
  assert.deepEqual(result.alternatives, []);
  assert.deepEqual(result.requirement.source, input.source);
  assert.notStrictEqual(result.requirement.source, input.source);
});

test('duplicate detection covers both reserved object IDs and the same source requirement', () => {
  const input = requirement();
  const existing = createThreadComponentRequest(input, 'agent', '2026-11-17T10:00:00.000Z');
  assert.equal(findDuplicateThreadRequest(input, [existing])?.requestId, input.requestId);

  const sameRequirement = requirement({
    requestId: 'thread.request.status-timeline-second',
    objectId: 'thread.component.status-timeline-second',
  });
  assert.equal(findDuplicateThreadRequest(sameRequirement, [existing])?.requestId, input.requestId);
  assert.equal(
    findDuplicateThreadRequest(
      requirement({
        requestId: 'thread.request.other-discovery',
        objectId: 'thread.component.other-discovery',
        name: 'OtherDiscovery',
      }),
      [existing as ThreadComponentRequest],
    ),
    undefined,
  );
});
