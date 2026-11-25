import type { FastifyInstance, FastifyRequest } from 'fastify';
import { requireCapability } from '../../bobbin/server/authorization.ts';
import { RuntimeError } from '../../bobbin/server/errors.ts';
import type { ThreadActorRole } from '../inventory/contracts.ts';
import { listThreadInventory } from '../inventory/registry.ts';
import type { ThreadInventoryCatalogProvider } from '../releases/catalog.ts';
import { ThreadReleaseDataError } from '../releases/repository.ts';
import type {
  NewThreadCandidate,
  NewThreadComponentRequest,
  ThreadEvidenceResult,
  ThreadQualityGate,
  ThreadRequestId,
} from './contracts.ts';
import {
  ThreadRepositoryConflictError,
  ThreadRepositoryDataError,
  type ThreadRequestRepository,
} from './repository.ts';
import {
  approveThreadCandidate,
  attachThreadCandidate,
  createThreadComponentRequest,
  recordThreadCandidateEvidence,
  returnThreadCandidateToWork,
  submitThreadCandidateForReview,
} from './workflow.ts';

const requestIdSchema = {
  type: 'string',
  pattern: '^thread\\.request\\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*$',
} as const;
const identifierSchema = { type: 'string', pattern: '^[A-Za-z0-9:_-]{1,128}$' } as const;
export const newThreadComponentRequestSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['requestId', 'objectId', 'name', 'description', 'category', 'owner', 'source'],
  properties: {
    requestId: requestIdSchema,
    objectId: {
      type: 'string',
      pattern: '^thread\\.component\\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*$',
    },
    name: { type: 'string', pattern: '^[A-Z][A-Za-z0-9]{0,79}$' },
    description: { type: 'string', minLength: 1, maxLength: 500 },
    category: {
      type: 'string',
      enum: ['primitive', 'form', 'data-display', 'navigation', 'feedback', 'layout', 'domain'],
    },
    owner: {
      type: 'object',
      additionalProperties: false,
      required: ['team', 'issueLabel'],
      properties: {
        team: { type: 'string', minLength: 1, maxLength: 100 },
        issueLabel: { type: 'string', pattern: '^[a-z0-9][a-z0-9:_-]{0,79}$' },
      },
    },
    source: {
      oneOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'fileKey', 'componentKey', 'nodeId'],
          properties: {
            kind: { const: 'figma' },
            fileKey: identifierSchema,
            componentKey: identifierSchema,
            nodeId: identifierSchema,
          },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'appId', 'sourcePath'],
          properties: {
            kind: { const: 'application' },
            appId: { type: 'string', pattern: '^[a-z][a-z0-9-]{0,79}$' },
            sourcePath: { type: 'string', minLength: 1, maxLength: 240 },
          },
        },
      ],
    },
  },
} as const;
const timestamp = () => new Date().toISOString();

function timestampAfter(previous: string): string {
  return new Date(Math.max(Date.now(), Date.parse(previous) + 1)).toISOString();
}

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

function mapThreadError(error: unknown): never {
  if (error instanceof RuntimeError) throw error;
  if (error instanceof ThreadRepositoryConflictError)
    throw new RuntimeError(409, 'THREAD_REQUEST_CONFLICT', error.message);
  if (error instanceof ThreadRepositoryDataError || error instanceof ThreadReleaseDataError)
    throw new RuntimeError(
      503,
      'THREAD_REPOSITORY_UNAVAILABLE',
      'The Thread request repository could not be read safely.',
    );
  const message = error instanceof Error ? error.message : 'Thread workflow operation failed.';
  if (/not allowed for|cannot be recorded by/.test(message))
    throw new RuntimeError(403, 'THREAD_ROLE_FORBIDDEN', message);
  if (/already exists|only a |requires|missing|changed|precedes|can only/.test(message))
    throw new RuntimeError(409, 'THREAD_WORKFLOW_CONFLICT', message);
  throw new RuntimeError(400, 'THREAD_REQUEST_INVALID', message);
}

async function loadRequest(repository: ThreadRequestRepository, requestId: ThreadRequestId) {
  try {
    const request = await repository.get(requestId);
    if (!request)
      throw new RuntimeError(404, 'THREAD_REQUEST_NOT_FOUND', 'The Thread request was not found.');
    return request;
  } catch (error) {
    return mapThreadError(error);
  }
}

export function registerThreadPipelineRoutes(
  app: FastifyInstance,
  repository: ThreadRequestRepository,
  catalog: ThreadInventoryCatalogProvider = async () => listThreadInventory(),
) {
  app.get('/api/thread/v1/inventory', async (request) => {
    requireCapability(request, 'thread:inventory:read');
    try {
      const items = await catalog();
      return { items, total: items.length };
    } catch (error) {
      return mapThreadError(error);
    }
  });

  app.get('/api/thread/v1/requests', async (request) => {
    requireCapability(request, 'thread:requests:read');
    try {
      const items = await repository.list();
      return { items, total: items.length };
    } catch (error) {
      return mapThreadError(error);
    }
  });

  app.post<{ Body: NewThreadComponentRequest }>(
    '/api/thread/v1/requests',
    {
      schema: {
        body: newThreadComponentRequestSchema,
      },
    },
    async (request, reply) => {
      try {
        const existing = (await catalog()).find(
          (item) => item.objectId === request.body.objectId || item.name === request.body.name,
        );
        if (existing)
          throw new RuntimeError(
            409,
            'THREAD_REQUEST_CONFLICT',
            'The Thread inventory already reserves this component identity.',
          );
        const created = createThreadComponentRequest(
          request.body,
          threadActor(request),
          timestamp(),
        );
        await repository.save(created);
        return reply.code(201).send(created);
      } catch (error) {
        return mapThreadError(error);
      }
    },
  );

  app.post<{ Params: { requestId: ThreadRequestId }; Body: NewThreadCandidate }>(
    '/api/thread/v1/requests/:requestId/candidate',
    {
      schema: {
        params: {
          type: 'object',
          additionalProperties: false,
          required: ['requestId'],
          properties: { requestId: requestIdSchema },
        },
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['version', 'code', 'figma'],
          properties: {
            version: { type: 'string', minLength: 1, maxLength: 80 },
            code: {
              type: 'object',
              additionalProperties: false,
              required: ['framework', 'packageName', 'exportName', 'sourcePath'],
              properties: {
                framework: { const: 'react' },
                packageName: { type: 'string', minLength: 1, maxLength: 160 },
                exportName: { type: 'string', pattern: '^[A-Z][A-Za-z0-9]{0,79}$' },
                sourcePath: { type: 'string', minLength: 1, maxLength: 240 },
              },
            },
            figma: {
              type: 'object',
              additionalProperties: false,
              required: ['status'],
              properties: {
                status: { type: 'string', enum: ['unmapped', 'mapped', 'verified'] },
                fileKey: identifierSchema,
                componentKey: identifierSchema,
                nodeId: identifierSchema,
              },
            },
          },
        },
      },
    },
    async (request) => {
      const current = await loadRequest(repository, request.params.requestId);
      try {
        const updated = attachThreadCandidate(
          current,
          request.body,
          threadActor(request),
          timestampAfter(current.updatedAt),
        );
        return await repository.save(updated, current.updatedAt);
      } catch (error) {
        return mapThreadError(error);
      }
    },
  );

  app.post<{
    Params: { requestId: ThreadRequestId };
    Body: { gate: ThreadQualityGate; result: ThreadEvidenceResult; artifactId: string };
  }>(
    '/api/thread/v1/requests/:requestId/evidence',
    {
      schema: {
        params: {
          type: 'object',
          additionalProperties: false,
          required: ['requestId'],
          properties: { requestId: requestIdSchema },
        },
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['gate', 'result', 'artifactId'],
          properties: {
            gate: {
              type: 'string',
              enum: ['tests', 'accessibility', 'designReview', 'securityReview'],
            },
            result: { type: 'string', enum: ['passed', 'failed'] },
            artifactId: { type: 'string', pattern: '^[a-z0-9][a-z0-9._:-]{0,159}$' },
          },
        },
      },
    },
    async (request) => {
      const current = await loadRequest(repository, request.params.requestId);
      try {
        const updated = recordThreadCandidateEvidence(
          current,
          request.body.gate,
          request.body.result,
          request.body.artifactId,
          threadActor(request),
          timestampAfter(current.updatedAt),
        );
        return await repository.save(updated, current.updatedAt);
      } catch (error) {
        return mapThreadError(error);
      }
    },
  );

  const transition = (
    suffix: 'submit' | 'return',
    apply: (
      source: Awaited<ReturnType<typeof loadRequest>>,
      actor: ThreadActorRole,
      at: string,
    ) => ReturnType<typeof submitThreadCandidateForReview>,
  ) => {
    app.post<{ Params: { requestId: ThreadRequestId } }>(
      `/api/thread/v1/requests/:requestId/${suffix}`,
      {
        schema: {
          params: {
            type: 'object',
            additionalProperties: false,
            required: ['requestId'],
            properties: { requestId: requestIdSchema },
          },
        },
      },
      async (request) => {
        const current = await loadRequest(repository, request.params.requestId);
        try {
          const updated = apply(current, threadActor(request), timestampAfter(current.updatedAt));
          return await repository.save(updated, current.updatedAt);
        } catch (error) {
          return mapThreadError(error);
        }
      },
    );
  };
  transition('submit', submitThreadCandidateForReview);
  transition('return', returnThreadCandidateToWork);

  app.post<{ Params: { requestId: ThreadRequestId } }>(
    '/api/thread/v1/requests/:requestId/approve',
    {
      schema: {
        params: {
          type: 'object',
          additionalProperties: false,
          required: ['requestId'],
          properties: { requestId: requestIdSchema },
        },
      },
    },
    async (request) => {
      requireCapability(request, 'thread:governance:approve');
      const current = await loadRequest(repository, request.params.requestId);
      try {
        const approved = approveThreadCandidate(
          current,
          threadActor(request),
          timestampAfter(current.updatedAt),
        );
        await repository.save(approved.request, current.updatedAt);
        return approved;
      } catch (error) {
        return mapThreadError(error);
      }
    },
  );
}
