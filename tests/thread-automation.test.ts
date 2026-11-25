import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { gzipSync } from 'node:zlib';
import {
  ControlledTemplateBuilderAdapter,
  MockFigmaDesignSourceAdapter,
  ServerSha256ArtifactInspectorAdapter,
  createDefaultThreadAutomationAdapters,
} from '../platform/thread/automation/adapters.ts';
import type { ThreadAutomationAdapters } from '../platform/thread/automation/contracts.ts';
import {
  FileThreadAutomationRunRepository,
  InMemoryThreadAutomationRunRepository,
  ThreadAutomationRunDataError,
} from '../platform/thread/automation/repository.ts';
import {
  ThreadAutomationExecutionError,
  executeThreadAutomation,
} from '../platform/thread/automation/workflow.ts';
import { InMemoryThreadArtifactRepository } from '../platform/thread/artifacts/repository.ts';
import { InMemoryThreadBuildJobRepository } from '../platform/thread/jobs/repository.ts';
import { InMemoryThreadRequestRepository } from '../platform/thread/pipeline/repository.ts';

function dependencies(adapters = createDefaultThreadAutomationAdapters()) {
  return {
    requests: new InMemoryThreadRequestRepository(),
    jobs: new InMemoryThreadBuildJobRepository(),
    artifacts: new InMemoryThreadArtifactRepository(),
    runs: new InMemoryThreadAutomationRunRepository(),
    adapters,
  };
}

test('mock design source is allow-listed and returns defensive copies', async () => {
  const adapter = new MockFigmaDesignSourceAdapter();
  const first = await adapter.resolve('figma-promotion-banner');
  first.requirement.description = 'changed by caller';
  const second = await adapter.resolve('figma-promotion-banner');
  assert.notEqual(second.requirement.description, first.requirement.description);
  await assert.rejects(
    () => adapter.resolve('https://figma.example/token' as 'inventory-button'),
    /allow-listed/,
  );
});

test('artifact inspector computes the gzip SHA-256 on the server boundary', async () => {
  const source = await new MockFigmaDesignSourceAdapter().resolve('figma-promotion-banner');
  const build = await new ControlledTemplateBuilderAdapter().build(source);
  const inspected = await new ServerSha256ArtifactInspectorAdapter().inspect(source, build);
  const expected = createHash('sha256')
    .update(gzipSync(Buffer.from(build.sourceText, 'utf8'), { level: 9 }))
    .digest('hex');
  assert.equal(inspected.content.sha256, expected);
  assert.ok(inspected.content.sizeBytes > 0);
  assert.equal('archive' in inspected, false);
});

test('automation stops after inventory discovery when a component already exists', async () => {
  const stores = dependencies();
  const result = await executeThreadAutomation(
    { runId: 'thread.adapter-run.button-reuse', fixtureId: 'inventory-button' },
    'agent',
    stores,
    {
      at: '2026-11-17T12:00:00.000Z',
      correlationId: 'thread.correlation.button-reuse',
    },
  );
  assert.equal(result.run.status, 'completed');
  assert.equal(result.run.outcome, 'inventory-resolved');
  assert.equal(result.run.discoveryDecision, 'review-alternatives');
  assert.equal((await stores.requests.list()).length, 0);
  assert.equal((await stores.jobs.list()).length, 0);
  assert.equal((await stores.artifacts.list()).length, 0);
});

test('inventory gap becomes a correlated staged artifact without executing source', async () => {
  const stores = dependencies();
  const first = await executeThreadAutomation(
    { runId: 'thread.adapter-run.promotion-gap', fixtureId: 'figma-promotion-banner' },
    'agent',
    stores,
    {
      at: '2026-11-17T12:10:00.000Z',
      correlationId: 'thread.correlation.promotion-gap',
    },
  );
  assert.equal(first.run.outcome, 'artifact-staged');
  assert.equal(first.run.discoveryDecision, 'inventory-gap');
  assert.equal((await stores.requests.list())[0].status, 'requested');
  assert.equal((await stores.jobs.list())[0].status, 'candidate-ready');
  const artifact = (await stores.artifacts.list())[0];
  assert.equal(artifact.status, 'staged');
  assert.equal(artifact.content.sha256.length, 64);
  assert.equal('sourceText' in artifact, false);

  const replay = await executeThreadAutomation(
    { runId: 'thread.adapter-run.promotion-gap', fixtureId: 'figma-promotion-banner' },
    'agent',
    stores,
  );
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.run, first.run);
  assert.equal((await stores.requests.list()).length, 1);
});

test('adapter failure is bounded and durably correlated', async () => {
  const base = createDefaultThreadAutomationAdapters();
  const failing: ThreadAutomationAdapters = {
    ...base,
    componentBuilder: {
      id: 'controlled-failure@1.0.0',
      async build() {
        throw new Error('Reviewed template unavailable\nsecret should not expand');
      },
    },
  };
  const stores = dependencies(failing);
  await assert.rejects(
    () =>
      executeThreadAutomation(
        { runId: 'thread.adapter-run.failed-build', fixtureId: 'figma-promotion-banner' },
        'agent',
        stores,
        {
          at: '2026-11-17T12:20:00.000Z',
          correlationId: 'thread.correlation.failed-build',
        },
      ),
    ThreadAutomationExecutionError,
  );
  const run = await stores.runs.get('thread.adapter-run.failed-build');
  assert.equal(run?.status, 'failed');
  assert.equal(run?.failure?.code, 'adapter-failed');
  assert.doesNotMatch(run?.failure?.message ?? '', /\n/);
  assert.equal((await stores.artifacts.list()).length, 0);
});

test('file adapter-run repository persists terminal runs and fails closed', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'overlock-automation-'));
  const path = join(directory, 'runs.json');
  const runs = new FileThreadAutomationRunRepository(path);
  const stores = { ...dependencies(), runs };
  const result = await executeThreadAutomation(
    { runId: 'thread.adapter-run.file-reuse', fixtureId: 'inventory-button' },
    'engineer',
    stores,
    {
      at: '2026-11-17T12:30:00.000Z',
      correlationId: 'thread.correlation.file-reuse',
    },
  );
  assert.deepEqual(await new FileThreadAutomationRunRepository(path).get(result.run.runId), result.run);

  const corrupt = join(directory, 'corrupt.json');
  await writeFile(corrupt, '{"schemaVersion":1,"runs":[{"token":"do-not-leak"}]}');
  await assert.rejects(
    () => new FileThreadAutomationRunRepository(corrupt).list(),
    ThreadAutomationRunDataError,
  );
});
