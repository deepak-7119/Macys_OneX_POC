import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PlatformMap } from '../platform/management/ManagementDashboard.tsx';
import {
  threadInventoryManagementRows,
  threadInventoryManagementSummary,
} from '../platform/management/threadInventory.ts';
import { manifests } from '../platform/spool/src/manifests.ts';

test('management inventory exposes every governed version and an honest review summary', () => {
  const rows = threadInventoryManagementRows(manifests);
  assert.equal(rows.length, 12);
  assert.equal(new Set(rows.map((row) => row.objectId)).size, 12);
  assert.deepEqual(threadInventoryManagementSummary(rows), {
    componentCount: 12,
    versionCount: 12,
    approvedVersionCount: 0,
    reviewVersionCount: 12,
    figmaMappedVersionCount: 0,
  });
  assert.ok(
    rows.every(
      (row) =>
        row.status === 'review' &&
        row.adoptionState === 'blocked' &&
        row.ownerTeam === 'Thread Platform' &&
        row.figma.status === 'unmapped',
    ),
  );
});

test('management inventory derives exact application usage from visible Spool manifests', () => {
  const rows = threadInventoryManagementRows(manifests);
  assert.deepEqual(rows.find((row) => row.name === 'DataTable')?.appIds, [
    'transaction-history',
    'associate-communications',
  ]);
  assert.deepEqual(rows.find((row) => row.name === 'QueryForm')?.appIds, ['transaction-history']);

  const communications = manifests.filter((app) => app.id === 'associate-communications');
  const restrictedRows = threadInventoryManagementRows(communications);
  assert.deepEqual(restrictedRows.find((row) => row.name === 'DataTable')?.appIds, [
    'associate-communications',
  ]);
  assert.deepEqual(restrictedRows.find((row) => row.name === 'QueryForm')?.appIds, []);
});

test('management view renders identity, ownership, evidence, Figma and usage fields', () => {
  const html = renderToStaticMarkup(
    React.createElement(PlatformMap, { apps: manifests, onClose() {} }),
  );
  assert.match(html, /Thread management inventory/i);
  assert.match(html, /POC DELIVERY MAP · PHASES 1–12/);
  assert.match(html, /How the implementation was built/);
  assert.match(html, /Phases 1–4/);
  assert.match(html, /Phases 5–7/);
  assert.match(html, /Phases 8–10/);
  assert.match(html, /Phase 11/);
  assert.match(html, /Phase 12/);
  assert.match(html, /12 governed phase gates/);
  assert.match(html, /Governed component records/);
  assert.match(html, /12 components · 12 versions/);
  assert.equal(html.match(/data-thread-object-id=/g)?.length, 12);
  assert.match(html, /thread\.component\.data-table/);
  assert.match(html, /thread:data-table/);
  assert.match(html, /@macys\/thread-react#DataTable/);
  assert.match(html, /New adoption blocked/);
  assert.match(html, /Accessibility/);
  assert.match(html, /Security/);
  assert.match(html, /unmapped/);
  assert.match(html, /Transaction History, Associate Communications/);
  assert.match(html, /Request, build, review, then register/);
  assert.match(html, /0 active requests/);
  assert.match(html, /Agent: request · build · test · submit/);
  assert.match(html, /Governance: approve · produce inventory-ready record/);
  assert.match(html, /has not invented an enterprise Figma mapping/);
  assert.match(html, /Phase 10 adapter may create typed requests; it cannot approve or promote/);
  assert.match(html, /Capability protected/);
  assert.match(html, /GET \/api\/thread\/v1\/inventory/);
  assert.match(html, /\/api\/thread\/v1\/requests/);
  assert.match(html, /File-backed mock repository/);
  assert.match(html, /current application session can read inventory only/i);
  assert.match(html, /Inventory-first component discovery/);
  assert.match(html, /Live deterministic adapter/);
  assert.match(html, /LIVE NON-PERSISTING PROBE/);
  assert.match(html, /Button lookup/);
  assert.match(html, /review-alternatives/);
  assert.match(html, /thread\.component\.button@1\.0\.0/);
  assert.match(html, /POST \/api\/thread\/v1\/discovery/);
  assert.match(html, /0 approved for reuse · 12 present but blocked in review/);
  assert.match(html, /Agent build jobs and role-aware workbench/);
  assert.match(html, /queued/);
  assert.match(html, /candidate-ready/);
  assert.match(html, /Generated code/);
  assert.match(html, /Execution disabled/);
  assert.match(html, /GET \/api\/thread\/v1\/workbench/);
  assert.match(html, /POST \/api\/thread\/v1\/build-jobs\/:jobId\/attach/);
  assert.match(html, /Not claimed: a live Figma connector/);
  assert.match(html, /Candidate artifact quarantine/);
  assert.match(html, /Verified artifact required/);
  assert.match(html, /Provenance evidence/);
  assert.match(html, /Dependency-audit evidence/);
  assert.match(html, /License-review evidence/);
  assert.match(html, /SHA-256 \+ size \+ application\/gzip/);
  assert.match(html, /GET \/api\/thread\/v1\/artifacts/);
  assert.match(html, /POST \/api\/thread\/v1\/artifacts\/:artifactId\/verify/);
  assert.match(html, /Current runtime: 0 artifact manifests/);
  assert.match(html, /Phase 10 computes content identity/);
  assert.match(html, /Figma-to-quarantine pipeline/);
  assert.match(html, /Deterministic mocks implemented/);
  assert.match(html, /Resolve design fixture/);
  assert.match(html, /Search inventory first/);
  assert.match(html, /Inspect on server/);
  assert.match(html, /ThreadDesignSourceAdapter/);
  assert.match(html, /ThreadComponentBuilderAdapter/);
  assert.match(html, /ThreadArtifactInspectorAdapter/);
  assert.match(html, /Figma URL · access token · free-form prompt · command · package bytes/);
  assert.match(html, /GET \/api\/thread\/v1\/automation\/runs/);
  assert.match(html, /Current runtime: 0 adapter runs/);
  assert.match(html, /Verified promotion, reuse and rollback/);
  assert.match(html, /Final POC lifecycle implemented/);
  assert.match(html, /Complete human review/);
  assert.match(html, /Promote exact evidence chain/);
  assert.match(html, /Publish to runtime catalog/);
  assert.match(html, /Rollback without deletion/);
  assert.match(html, /promote-release/);
  assert.match(html, /rollback-release/);
  assert.match(html, /GET \/api\/thread\/v1\/releases/);
  assert.match(html, /POST \/api\/thread\/v1\/releases\/:releaseId\/rollback/);
  assert.match(html, /Current runtime: 0 release records/);
});
