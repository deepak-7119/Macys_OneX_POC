import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  ThreadInventoryComponent,
  ThreadQualityGates,
} from '../platform/thread/inventory/contracts.ts';
import {
  allowedThreadTransitions,
  assertThreadLifecycleTransition,
} from '../platform/thread/inventory/lifecycle.ts';
import {
  validateThreadComponentReference,
  validateThreadInventoryComponent,
} from '../platform/thread/inventory/validation.ts';

const passedQuality: ThreadQualityGates = {
  tests: 'passed',
  accessibility: 'passed',
  designReview: 'passed',
  securityReview: 'passed',
};

function component(): ThreadInventoryComponent {
  return {
    objectId: 'thread.component.data-table',
    name: 'DataTable',
    description: 'Accessible tabular results with application-provided columns and row actions.',
    category: 'data-display',
    owner: { team: 'Thread Platform', issueLabel: 'thread:data-table' },
    currentVersion: '1.0.0',
    versions: [
      {
        version: '1.0.0',
        status: 'approved',
        code: {
          framework: 'react',
          packageName: '@macys/thread-data-table',
          exportName: 'DataTable',
          sourcePath: 'platform/thread/src/index.tsx',
        },
        figma: { status: 'unmapped' },
        quality: { ...passedQuality },
        createdAt: '2026-11-17T09:00:00.000Z',
        updatedAt: '2026-11-17T10:00:00.000Z',
        approvedAt: '2026-11-17T09:30:00.000Z',
      },
    ],
    createdAt: '2026-11-17T09:00:00.000Z',
    updatedAt: '2026-11-17T10:00:00.000Z',
  };
}

test('inventory contract accepts a stable object ID with an approved semantic version', () => {
  const source = component();
  const validated = validateThreadInventoryComponent(source);
  assert.deepEqual(validated, source);
  assert.notStrictEqual(validated, source);
  assert.notStrictEqual(validated.versions, source.versions);
  assert.deepEqual(
    validateThreadComponentReference({ objectId: source.objectId, version: '1.0.0' }),
    { objectId: source.objectId, version: '1.0.0' },
  );
});

test('object IDs and references reject aliases, executable values and unknown fields', () => {
  for (const objectId of [
    'DataTable',
    'thread.component.DataTable',
    'thread.component.data_table',
    'javascript:alert(1)',
    '../thread.component.data-table',
  ]) {
    assert.throws(() => validateThreadInventoryComponent({ ...component(), objectId }));
    assert.throws(() => validateThreadComponentReference({ objectId, version: '1.0.0' }));
  }
  assert.throws(() =>
    validateThreadInventoryComponent({ ...component(), executableFactory: 'alert(1)' }),
  );
  assert.throws(() =>
    validateThreadComponentReference({
      objectId: 'thread.component.data-table',
      version: '1.0.0',
      target: 'https://example.invalid',
    }),
  );
});

test('version history is unique and currentVersion must identify a released version', () => {
  const duplicate = component();
  duplicate.versions.push(structuredClone(duplicate.versions[0]));
  assert.throws(() => validateThreadInventoryComponent(duplicate), /duplicated/);

  const missing = component();
  missing.currentVersion = '2.0.0';
  assert.throws(() => validateThreadInventoryComponent(missing), /released version/);

  const candidate = component();
  candidate.currentVersion = '1.1.0';
  candidate.versions.push({
    ...structuredClone(candidate.versions[0]),
    version: '1.1.0',
    status: 'candidate',
    approvedAt: undefined,
    quality: { ...passedQuality, designReview: 'pending' },
  });
  assert.throws(() => validateThreadInventoryComponent(candidate), /released version/);
});

test('code and Figma bindings accept identifiers but reject paths, URLs and partial mappings', () => {
  const unsafeSource = component();
  unsafeSource.versions[0].code.sourcePath = '../outside/thread.tsx';
  assert.throws(() => validateThreadInventoryComponent(unsafeSource), /source path/);

  const remoteSource = component();
  remoteSource.versions[0].code.sourcePath = 'https://example.invalid/component.tsx';
  assert.throws(() => validateThreadInventoryComponent(remoteSource), /source path/);

  const partialFigma = component();
  partialFigma.versions[0].figma = { status: 'mapped', fileKey: 'file-key' };
  assert.throws(() => validateThreadInventoryComponent(partialFigma), /requires all IDs/);

  const mapped = component();
  mapped.versions[0].figma = {
    status: 'verified',
    fileKey: 'file-key',
    componentKey: 'component-key',
    nodeId: '1234:5678',
  };
  assert.doesNotThrow(() => validateThreadInventoryComponent(mapped));
});

test('agents can create and submit candidates but cannot approve inventory versions', () => {
  assert.doesNotThrow(() =>
    assertThreadLifecycleTransition('requested', 'candidate', 'agent', passedQuality),
  );
  assert.doesNotThrow(() =>
    assertThreadLifecycleTransition('candidate', 'review', 'agent', passedQuality),
  );
  assert.throws(
    () => assertThreadLifecycleTransition('review', 'approved', 'agent', passedQuality),
    /not allowed for agent/,
  );
  assert.deepEqual(allowedThreadTransitions('review', 'agent'), []);
});

test('governance approval requires every automated and human quality gate to pass', () => {
  assert.doesNotThrow(() =>
    assertThreadLifecycleTransition('review', 'approved', 'governance', passedQuality),
  );
  for (const gate of Object.keys(passedQuality) as Array<keyof ThreadQualityGates>) {
    assert.throws(
      () =>
        assertThreadLifecycleTransition('review', 'approved', 'governance', {
          ...passedQuality,
          [gate]: 'pending',
        }),
      /every quality gate/,
    );
  }
  assert.throws(() =>
    assertThreadLifecycleTransition('review', 'approved', 'designer', passedQuality),
  );
});

test('only governance can deprecate and retire a released component version', () => {
  assert.doesNotThrow(() =>
    assertThreadLifecycleTransition('approved', 'deprecated', 'governance', passedQuality),
  );
  assert.doesNotThrow(() =>
    assertThreadLifecycleTransition('deprecated', 'retired', 'governance', passedQuality),
  );
  assert.throws(() =>
    assertThreadLifecycleTransition('approved', 'retired', 'governance', passedQuality),
  );
  assert.throws(() =>
    assertThreadLifecycleTransition('approved', 'deprecated', 'engineer', passedQuality),
  );
});
