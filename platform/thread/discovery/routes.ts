import type { FastifyInstance, FastifyRequest } from 'fastify';
import { requireCapability } from '../../bobbin/server/authorization.ts';
import { RuntimeError } from '../../bobbin/server/errors.ts';
import type { ThreadActorRole } from '../inventory/contracts.ts';
import type { NewThreadComponentRequest } from '../pipeline/contracts.ts';
import {
  ThreadRepositoryConflictError,
  ThreadRepositoryDataError,
  type ThreadRequestRepository,
} from '../pipeline/repository.ts';
import { newThreadComponentRequestSchema } from '../pipeline/routes.ts';
import { createThreadComponentRequest } from '../pipeline/workflow.ts';
import { discoverThreadComponents, findDuplicateThreadRequest } from './service.ts';
import { listThreadInventory } from '../inventory/registry.ts';
import type { ThreadInventoryCatalogProvider } from '../releases/catalog.ts';
import { ThreadReleaseDataError } from '../releases/repository.ts';

function threadActor(request: FastifyRequest): ThreadActorRole {
  const session = requireCapability(request, 'thread:requests:write');
  if (!session.threadActor)
    throw new RuntimeError(
      403,
      'THREAD_ROLE_FORBIDDEN',
      'This synthetic identity has no Thread workflow role.',
    );
  return session.threadActor;
}

function mapDiscoveryError(error: unknown): never {
  if (error instanceof RuntimeError) throw error;
  if (error instanceof ThreadRepositoryConflictError)
    throw new RuntimeError(409, 'THREAD_REQUEST_CONFLICT', error.message);
  if (error instanceof ThreadRepositoryDataError)
    throw new RuntimeError(
      503,
      'THREAD_REPOSITORY_UNAVAILABLE',
      'The Thread request repository could not be read safely.',
    );
  if (error instanceof ThreadReleaseDataError)
    throw new RuntimeError(
      503,
      'THREAD_REPOSITORY_UNAVAILABLE',
      'The Thread release repository could not be read safely.',
    );
  throw new RuntimeError(
    400,
    'THREAD_DISCOVERY_INVALID',
    error instanceof Error ? error.message : 'Thread discovery could not evaluate the requirement.',
  );
}

export function registerThreadDiscoveryRoutes(
  app: FastifyInstance,
  repository: ThreadRequestRepository,
  catalog: ThreadInventoryCatalogProvider = async () => listThreadInventory(),
) {
  app.post<{ Body: NewThreadComponentRequest }>(
    '/api/thread/v1/discovery',
    { schema: { body: newThreadComponentRequestSchema } },
    async (request) => {
      requireCapability(request, 'thread:inventory:read');
      try {
        return discoverThreadComponents(request.body, await catalog());
      } catch (error) {
        return mapDiscoveryError(error);
      }
    },
  );

  app.post<{ Body: NewThreadComponentRequest }>(
    '/api/thread/v1/discovery/request',
    { schema: { body: newThreadComponentRequestSchema } },
    async (request, reply) => {
      const actor = threadActor(request);
      try {
        const discovery = discoverThreadComponents(request.body, await catalog());
        if (!discovery.canOpenRequest) return { discovery, request: null };
        const duplicate = findDuplicateThreadRequest(request.body, await repository.list());
        if (duplicate)
          throw new RuntimeError(
            409,
            'THREAD_REQUEST_DUPLICATE',
            'An active Thread request already covers this object or source requirement.',
            { existingRequestId: duplicate.requestId },
          );
        const created = createThreadComponentRequest(request.body, actor, new Date().toISOString());
        await repository.save(created);
        return reply.code(201).send({ discovery, request: created });
      } catch (error) {
        return mapDiscoveryError(error);
      }
    },
  );
}
