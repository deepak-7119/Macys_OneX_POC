import { randomUUID } from 'node:crypto';
import type { ThreadActorRole } from '../inventory/contracts.ts';
import { discoverThreadComponents, findDuplicateThreadRequest } from '../discovery/service.ts';
import { createThreadComponentRequest } from '../pipeline/workflow.ts';
import type { ThreadRequestRepository } from '../pipeline/repository.ts';
import {
  claimThreadBuildJob,
  createThreadBuildJob,
  submitThreadBuildJob,
} from '../jobs/workflow.ts';
import type { ThreadBuildJobId } from '../jobs/contracts.ts';
import type { ThreadBuildJobRepository } from '../jobs/repository.ts';
import { stageThreadArtifact } from '../artifacts/workflow.ts';
import type { ThreadArtifactRepository } from '../artifacts/repository.ts';
import type {
  NewThreadAutomationRun,
  ThreadAutomationAdapters,
  ThreadAutomationCorrelationId,
  ThreadAutomationExecution,
  ThreadAutomationRun,
} from './contracts.ts';
import type { ThreadAutomationRunRepository } from './repository.ts';
import { validateNewThreadAutomationRun, validateThreadAutomationRun } from './validation.ts';
import type { ThreadInventoryCatalogProvider } from '../releases/catalog.ts';

type BuildActor = Extract<ThreadActorRole, 'agent' | 'engineer'>;

export interface ThreadAutomationDependencies {
  requests: ThreadRequestRepository;
  jobs: ThreadBuildJobRepository;
  artifacts: ThreadArtifactRepository;
  runs: ThreadAutomationRunRepository;
  adapters: ThreadAutomationAdapters;
  catalog?: ThreadInventoryCatalogProvider;
}

export interface ThreadAutomationOptions {
  at?: string;
  correlationId?: ThreadAutomationCorrelationId;
}

export class ThreadAutomationExecutionError extends Error {
  readonly run: ThreadAutomationRun;

  constructor(run: ThreadAutomationRun) {
    super('The controlled Thread adapter pipeline failed. Inspect its correlated run record.');
    this.name = 'ThreadAutomationExecutionError';
    this.run = validateThreadAutomationRun(run);
  }
}

function buildActor(actor: ThreadActorRole): BuildActor {
  if (actor !== 'agent' && actor !== 'engineer')
    throw new Error(`Thread automation is not allowed for ${actor}.`);
  return actor;
}

function sequence(start: string) {
  const parsed = Date.parse(start);
  if (Number.isNaN(parsed)) throw new Error('Thread automation start timestamp is invalid.');
  let current = parsed;
  return () => new Date(current++).toISOString();
}

function jobIdFor(requestId: string): ThreadBuildJobId {
  return requestId.replace('thread.request.', 'thread.build-job.') as ThreadBuildJobId;
}

function failureMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : 'The controlled adapter failed.';
  const cleaned = message.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  return (cleaned || 'The controlled adapter failed.').slice(0, 300);
}

export async function executeThreadAutomation(
  inputSource: NewThreadAutomationRun,
  actorSource: ThreadActorRole,
  dependencies: ThreadAutomationDependencies,
  options: ThreadAutomationOptions = {},
): Promise<ThreadAutomationExecution> {
  const input = validateNewThreadAutomationRun(inputSource);
  const existing = await dependencies.runs.get(input.runId);
  if (existing) return { run: existing, replayed: true };
  const actor = buildActor(actorSource);
  const startedAt = options.at ?? new Date().toISOString();
  const nextAt = sequence(startedAt);
  const createdAt = nextAt();
  let run = validateThreadAutomationRun({
    runId: input.runId,
    correlationId:
      options.correlationId ?? (`thread.correlation.${randomUUID()}` as ThreadAutomationCorrelationId),
    fixtureId: input.fixtureId,
    sourceProvider: 'mock-figma',
    status: 'running',
    initiatedBy: actor,
    adapters: {
      designSource: dependencies.adapters.designSource.id,
      componentBuilder: dependencies.adapters.componentBuilder.id,
      artifactInspector: dependencies.adapters.artifactInspector.id,
    },
    createdAt,
    updatedAt: createdAt,
  });
  run = await dependencies.runs.save(run);

  async function checkpoint(change: Partial<ThreadAutomationRun>) {
    const previous = run.updatedAt;
    run = validateThreadAutomationRun({ ...run, ...change, updatedAt: nextAt() });
    run = await dependencies.runs.save(run, previous);
  }

  try {
    const source = await dependencies.adapters.designSource.resolve(input.fixtureId);
    const discovery = discoverThreadComponents(
      source.requirement,
      dependencies.catalog ? await dependencies.catalog() : undefined,
    );
    await checkpoint({ discoveryDecision: discovery.decision });
    if (!discovery.canOpenRequest) {
      const completedAt = nextAt();
      const previous = run.updatedAt;
      run = validateThreadAutomationRun({
        ...run,
        status: 'completed',
        outcome: 'inventory-resolved',
        completedAt,
        updatedAt: completedAt,
      });
      run = await dependencies.runs.save(run, previous);
      return { run, replayed: false };
    }

    const duplicate = findDuplicateThreadRequest(source.requirement, await dependencies.requests.list());
    if (duplicate) throw new Error('An active Thread request already covers this design requirement.');
    const request = createThreadComponentRequest(source.requirement, actor, nextAt());
    await dependencies.requests.save(request);
    await checkpoint({ requestId: request.requestId });

    const jobId = jobIdFor(request.requestId);
    if (await dependencies.jobs.getByRequest(request.requestId))
      throw new Error('A build job already exists for this design requirement.');
    const queued = createThreadBuildJob(jobId, request, actor, nextAt());
    await dependencies.jobs.save(queued);
    await checkpoint({ jobId });
    const running = claimThreadBuildJob(queued, actor, nextAt());
    await dependencies.jobs.save(running, queued.updatedAt);

    const build = await dependencies.adapters.componentBuilder.build(source);
    const inspected = await dependencies.adapters.artifactInspector.inspect(source, build);
    const submitted = submitThreadBuildJob(running, request, build.submission, actor, nextAt());
    await dependencies.jobs.save(submitted, running.updatedAt);
    const artifact = stageThreadArtifact(
      submitted,
      {
        artifactId: source.artifactId,
        content: inspected.content,
        sourceEvidence: inspected.sourceEvidence,
      },
      actor,
      nextAt(),
    );
    await dependencies.artifacts.save(artifact);

    const completedAt = nextAt();
    const previous = run.updatedAt;
    run = validateThreadAutomationRun({
      ...run,
      status: 'completed',
      outcome: 'artifact-staged',
      artifactId: artifact.artifactId,
      completedAt,
      updatedAt: completedAt,
    });
    run = await dependencies.runs.save(run, previous);
    return { run, replayed: false };
  } catch (error) {
    const completedAt = nextAt();
    const previous = run.updatedAt;
    run = validateThreadAutomationRun({
      ...run,
      status: 'failed',
      failure: { code: 'adapter-failed', message: failureMessage(error) },
      completedAt,
      updatedAt: completedAt,
    });
    run = await dependencies.runs.save(run, previous);
    throw new ThreadAutomationExecutionError(run);
  }
}
