import type { FastifyInstance, FastifyRequest } from 'fastify';
import { requireCapability } from '../../bobbin/server/authorization.ts';
import { RuntimeError } from '../../bobbin/server/errors.ts';
import type { ThreadActorRole } from '../inventory/contracts.ts';
import { ThreadRepositoryConflictError, ThreadRepositoryDataError, type ThreadRequestRepository } from '../pipeline/repository.ts';
import { ThreadBuildJobConflictError, ThreadBuildJobDataError, type ThreadBuildJobRepository } from '../jobs/repository.ts';
import { ThreadArtifactConflictError, ThreadArtifactDataError, type ThreadArtifactRepository } from '../artifacts/repository.ts';
import type { NewThreadAutomationRun } from './contracts.ts';
import {
  ThreadAutomationRunConflictError,
  ThreadAutomationRunDataError,
  type ThreadAutomationRunRepository,
} from './repository.ts';
import { ThreadAutomationExecutionError, executeThreadAutomation } from './workflow.ts';
import type { ThreadAutomationAdapters } from './contracts.ts';
import type { ThreadInventoryCatalogProvider } from '../releases/catalog.ts';

function threadActor(request: FastifyRequest, capability: 'read' | 'write'): ThreadActorRole {
  const session = requireCapability(request, `thread:requests:${capability}`);
  if (!session.threadActor)
    throw new RuntimeError(403, 'THREAD_ROLE_FORBIDDEN', 'This synthetic identity has no Thread workflow role.');
  return session.threadActor;
}

function mapAutomationError(error: unknown): never {
  if (error instanceof RuntimeError) throw error;
  if (error instanceof ThreadAutomationExecutionError)
    throw new RuntimeError(
      502,
      'THREAD_ADAPTER_FAILED',
      'The controlled Thread adapter pipeline failed. Inspect the correlated run record.',
      { runId: error.run.runId, correlationId: error.run.correlationId },
    );
  if (
    error instanceof ThreadAutomationRunConflictError ||
    error instanceof ThreadRepositoryConflictError ||
    error instanceof ThreadBuildJobConflictError ||
    error instanceof ThreadArtifactConflictError
  )
    throw new RuntimeError(409, 'THREAD_AUTOMATION_CONFLICT', error.message);
  if (
    error instanceof ThreadAutomationRunDataError ||
    error instanceof ThreadRepositoryDataError ||
    error instanceof ThreadBuildJobDataError ||
    error instanceof ThreadArtifactDataError
  )
    throw new RuntimeError(503, 'THREAD_REPOSITORY_UNAVAILABLE', 'A Thread workflow repository could not be read safely.');
  const message = error instanceof Error ? error.message : 'Thread automation could not start.';
  if (/not allowed for/.test(message))
    throw new RuntimeError(403, 'THREAD_ROLE_FORBIDDEN', message);
  throw new RuntimeError(400, 'THREAD_AUTOMATION_INVALID', message);
}

export function registerThreadAutomationRoutes(
  app: FastifyInstance,
  requests: ThreadRequestRepository,
  jobs: ThreadBuildJobRepository,
  artifacts: ThreadArtifactRepository,
  runs: ThreadAutomationRunRepository,
  adapters: ThreadAutomationAdapters,
  catalog?: ThreadInventoryCatalogProvider,
) {
  app.get('/api/thread/v1/automation/runs', async (request) => {
    threadActor(request, 'read');
    try {
      const items = await runs.list();
      return { items, total: items.length };
    } catch (error) {
      return mapAutomationError(error);
    }
  });

  app.post<{ Body: NewThreadAutomationRun }>(
    '/api/thread/v1/automation/runs',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['runId', 'fixtureId'],
          properties: {
            runId: { type: 'string', pattern: '^thread\\.adapter-run\\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*$' },
            fixtureId: { type: 'string', enum: ['inventory-button', 'figma-promotion-banner'] },
          },
        },
      },
    },
    async (request, reply) => {
      const actor = threadActor(request, 'write');
      try {
        const result = await executeThreadAutomation(request.body, actor, {
          requests,
          jobs,
          artifacts,
          runs,
          adapters,
          ...(catalog ? { catalog } : {}),
        });
        return reply.code(result.replayed ? 200 : 201).send(result.run);
      } catch (error) {
        return mapAutomationError(error);
      }
    },
  );
}
