import assert from 'node:assert/strict';
import test from 'node:test';
import * as Thread from '../platform/thread/src/index.tsx';
import { manifests } from '../platform/spool/src/manifests.ts';
import {
  findThreadInventoryComponentByExport,
  getThreadInventoryComponent,
  listThreadInventory,
  resolveThreadComponentReference,
  threadInventoryExclusions,
} from '../platform/thread/inventory/registry.ts';
import { validateThreadInventoryComponent } from '../platform/thread/inventory/validation.ts';

const expectedComponents = [
  'BackButton',
  'Badge',
  'Button',
  'ContextBar',
  'DataTable',
  'Feedback',
  'PageHeader',
  'Panel',
  'QueryForm',
  'RequestError',
  'ResultsSummary',
  'Tabs',
];

test('registry contains every actual Thread React component export exactly once', () => {
  const inventoryNames = listThreadInventory()
    .map((component) => component.name)
    .sort();
  const runtimeComponents = Object.entries(Thread)
    .filter(([name, value]) => name !== 'money' && typeof value === 'function')
    .map(([name]) => name)
    .sort();
  assert.deepEqual(inventoryNames, expectedComponents);
  assert.deepEqual(inventoryNames, runtimeComponents);
});

test('baseline records use stable IDs, unique issue labels and valid versioned contracts', () => {
  const inventory = listThreadInventory();
  assert.equal(inventory.length, 12);
  assert.equal(new Set(inventory.map((item) => item.objectId)).size, inventory.length);
  assert.equal(new Set(inventory.map((item) => item.owner.issueLabel)).size, inventory.length);
  for (const item of inventory) {
    assert.doesNotThrow(() => validateThreadInventoryComponent(item));
    assert.match(item.objectId, /^thread\.component\.[a-z][a-z0-9-]*$/);
    assert.equal(item.owner.team, 'Thread Platform');
    assert.equal(item.versions.length, 1);
    assert.equal(item.versions[0].version, '1.0.0');
    assert.equal(item.versions[0].code.exportName, item.name);
  }
});

test('baseline import remains in review without inventing approvals or Figma mappings', () => {
  for (const item of listThreadInventory()) {
    assert.equal(item.currentVersion, undefined);
    const version = item.versions[0];
    assert.equal(version.status, 'review');
    assert.equal(version.approvedAt, undefined);
    assert.deepEqual(version.figma, { status: 'unmapped' });
    assert.deepEqual(version.quality, {
      tests: 'passed',
      accessibility: 'pending',
      designReview: 'pending',
      securityReview: 'pending',
    });
  }
});

test('registry lookups return defensive copies rather than mutable approval records', () => {
  const first = getThreadInventoryComponent('thread.component.data-table');
  const byName = findThreadInventoryComponentByExport('DataTable');
  assert.ok(first && byName);
  assert.deepEqual(first, byName);
  assert.notStrictEqual(first, byName);
  first.name = 'ChangedLocally';
  first.versions[0].quality.tests = 'failed';
  const again = getThreadInventoryComponent('thread.component.data-table');
  assert.equal(again?.name, 'DataTable');
  assert.equal(again?.versions[0].quality.tests, 'passed');
  assert.equal(getThreadInventoryComponent('thread.component.unknown'), undefined);
  assert.equal(findThreadInventoryComponentByExport('UnknownComponent'), undefined);
});

test('app-local specialized components are explicitly excluded from Thread inventory', () => {
  const inventoryNames = new Set(listThreadInventory().map((component) => component.name));
  const manifestOnly = [...new Set(manifests.flatMap((manifest) => manifest.localComponents))]
    .filter((name) => !inventoryNames.has(name))
    .sort();
  assert.deepEqual(manifestOnly, ['DocumentViewer', 'Receipt']);
  assert.deepEqual(threadInventoryExclusions.map((item) => item.name).sort(), manifestOnly);
  assert.ok(
    threadInventoryExclusions.every(
      (item) => item.reason.includes('reuse is not yet demonstrated') && item.sourcePath,
    ),
  );
});

test('every Spool manifest pins unique, resolvable Thread object IDs and exact versions', () => {
  for (const manifest of manifests) {
    const objectIds = manifest.componentRefs.map((reference) => reference.objectId);
    assert.equal(new Set(objectIds).size, objectIds.length);
    for (const reference of manifest.componentRefs) {
      const resolved = resolveThreadComponentReference(reference);
      assert.ok(resolved, `${manifest.id} must resolve ${reference.objectId}@${reference.version}`);
      assert.equal(resolved.component.objectId, reference.objectId);
      assert.equal(resolved.version.version, reference.version);
      assert.equal(reference.version, '1.0.0');
    }
  }
});
