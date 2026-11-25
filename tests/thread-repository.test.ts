import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type {
  NewThreadCandidate,
  NewThreadComponentRequest,
} from '../platform/thread/pipeline/contracts.ts';
import {
  FileThreadRequestRepository,
  ThreadRepositoryConflictError,
  ThreadRepositoryDataError,
} from '../platform/thread/pipeline/repository.ts';
import {
  attachThreadCandidate,
  createThreadComponentRequest,
} from '../platform/thread/pipeline/workflow.ts';

function requestInput(suffix = 'repository'): NewThreadComponentRequest {
  return {
    requestId: `thread.request.status-timeline-${suffix}`,
    objectId: `thread.component.status-timeline-${suffix}`,
    name: 'StatusTimelineRepository',
    description: 'Presents a bounded sequence of labelled domain status events.',
    category: 'data-display',
    owner: { team: 'Thread Platform', issueLabel: 'thread:status-timeline' },
    source: {
      kind: 'application',
      appId: 'sample-app',
      sourcePath: 'applications/sample-app/status-timeline.tsx',
    },
  };
}

function candidateInput(): NewThreadCandidate {
  return {
    version: '0.1.0',
    code: {
      framework: 'react',
      packageName: '@macys/thread-react',
      exportName: 'StatusTimelineRepository',
      sourcePath: 'platform/thread/candidates/status-timeline.tsx',
    },
    figma: { status: 'unmapped' },
  };
}

async function repositoryFixture(t: test.TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'overlock-thread-repository-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { directory, path: join(directory, 'thread-requests.json') };
}

test('file repository persists validated requests across repository instances', async (t) => {
  const fixture = await repositoryFixture(t);
  const first = new FileThreadRequestRepository(fixture.path);
  const request = createThreadComponentRequest(requestInput(), 'agent', '2026-11-17T09:00:00.000Z');
  await first.save(request);

  const restarted = new FileThreadRequestRepository(fixture.path);
  assert.deepEqual(await restarted.get(request.requestId), request);
  assert.deepEqual(await restarted.list(), [request]);
});

test('file repository rejects stale writes and duplicate object reservations', async (t) => {
  const fixture = await repositoryFixture(t);
  const repository = new FileThreadRequestRepository(fixture.path);
  const request = createThreadComponentRequest(
    requestInput('conflict'),
    'agent',
    '2026-11-17T09:00:00.000Z',
  );
  await repository.save(request);
  await assert.rejects(
    repository.save(request, request.updatedAt),
    /must advance its concurrency timestamp/,
  );
  const firstEdit = attachThreadCandidate(
    request,
    candidateInput(),
    'agent',
    '2026-11-17T09:01:00.000Z',
  );
  const staleEdit = attachThreadCandidate(
    request,
    candidateInput(),
    'agent',
    '2026-11-17T09:02:00.000Z',
  );
  await repository.save(firstEdit, request.updatedAt);
  await assert.rejects(
    repository.save(staleEdit, request.updatedAt),
    ThreadRepositoryConflictError,
  );

  const duplicateObject = createThreadComponentRequest(
    {
      ...requestInput('different-request'),
      objectId: request.objectId,
    },
    'engineer',
    '2026-11-17T09:03:00.000Z',
  );
  await assert.rejects(repository.save(duplicateObject), ThreadRepositoryConflictError);
});

test('file repository fails closed for malformed or invalid persisted data', async (t) => {
  const fixture = await repositoryFixture(t);
  await writeFile(fixture.path, '{not-json', 'utf8');
  const malformed = new FileThreadRequestRepository(fixture.path);
  await assert.rejects(malformed.list(), ThreadRepositoryDataError);

  await writeFile(
    fixture.path,
    JSON.stringify({ schemaVersion: 1, requests: [{ executable: 'alert(1)' }] }),
    'utf8',
  );
  const invalid = new FileThreadRequestRepository(fixture.path);
  await assert.rejects(invalid.list(), ThreadRepositoryDataError);
});

test('file repository recovers the exact backup when a commit was interrupted', async (t) => {
  const fixture = await repositoryFixture(t);
  const request = createThreadComponentRequest(
    requestInput('recovery'),
    'agent',
    '2026-11-17T09:00:00.000Z',
  );
  await writeFile(
    `${fixture.path}.backup`,
    `${JSON.stringify({ schemaVersion: 1, requests: [request] }, null, 2)}\n`,
    'utf8',
  );
  const repository = new FileThreadRequestRepository(fixture.path);
  assert.deepEqual(await repository.list(), [request]);
});
