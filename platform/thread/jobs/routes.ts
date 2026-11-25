import type { FastifyInstance, FastifyRequest } from 'fastify';
import { requireCapability } from '../../bobbin/server/authorization.ts';
import { RuntimeError } from '../../bobbin/server/errors.ts';
import type { ThreadActorRole } from '../inventory/contracts.ts';
import { ThreadArtifactDataError, type ThreadArtifactRepository } from '../artifacts/repository.ts';
import type { ThreadRequestId } from '../pipeline/contracts.ts';
import {
  ThreadRepositoryConflictError,
  ThreadRepositoryDataError,
  type ThreadRequestRepository,
} from '../pipeline/repository.ts';
import type { NewThreadBuildSubmission, ThreadBuildJobId } from './contracts.ts';
import {
  ThreadBuildJobConflictError,
  ThreadBuildJobDataError,
  type ThreadBuildJobRepository,
} from './repository.ts';
import { buildThreadWorkbench } from './workbench.ts';
import { ThreadReleaseDataError, type ThreadReleaseRepository } from '../releases/repository.ts';
import {
  attachThreadBuildJob,
  claimThreadBuildJob,
  createThreadBuildJob,
  submitThreadBuildJob,
} from './workflow.ts';

const requestIdSchema = {
  type: 'string',
  pattern: '^thread\\.request\\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*$',
} as const;
const jobIdSchema = {
  type: 'string',
  pattern: '^thread\\.build-job\\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*$',
} as const;
const identifierSchema = { type: 'string', pattern: '^[A-Za-z0-9:_-]{1,128}$' } as const;
const jobParamsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['jobId'],
  properties: { jobId: jobIdSchema },
} as const;
const candidateSchema = {
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
} as const;

function timestampAfter(...previous: string[]): string {
  return new Date(
    Math.max(Date.now(), ...previous.map((value) => Date.parse(value) + 1)),
  ).toISOString();
}

function threadActor(request: FastifyRequest, capability: 'read' | 'write'): ThreadActorRole {
  const session = requireCapability(request, `thread:requests:${capability}`);
  if (!session.threadActor)
    throw new RuntimeError(
      403,
      'THREAD_ROLE_FORBIDDEN',
      'This synthetic identity has no Thread workflow role.',
    );
  return session.threadActor;
}

function mapThreadBuildError(error: unknown): never {
  if (error instanceof RuntimeError) throw error;
  if (
    error instanceof ThreadBuildJobConflictError ||
    error instanceof ThreadRepositoryConflictError
  )
    throw new RuntimeError(409, 'THREAD_BUILD_CONFLICT', error.message);
  if (
    error instanceof ThreadBuildJobDataError ||
    error instanceof ThreadRepositoryDataError ||
    error instanceof ThreadArtifactDataError ||
    error instanceof ThreadReleaseDataError
  )
    throw new RuntimeError(
      503,
      'THREAD_REPOSITORY_UNAVAILABLE',
      'A Thread workflow repository could not be read safely.',
    );
  const message = error instanceof Error ? error.message : 'Thread build operation failed.';
  if (/not allowed for|claiming role/.test(message))
    throw new RuntimeError(403, 'THREAD_ROLE_FORBIDDEN', message);
  if (/Only a |only attach|requires|identities do not|already exists|changed|missing/.test(message))
    throw new RuntimeError(409, 'THREAD_BUILD_CONFLICT', message);
  throw new RuntimeError(400, 'THREAD_BUILD_INVALID', message);
}

async function loadRequest(repository: ThreadRequestRepository, requestId: ThreadRequestId) {
  try {
    const request = await repository.get(requestId);
    if (!request)
      throw new RuntimeError(404, 'THREAD_REQUEST_NOT_FOUND', 'The Thread request was not found.');
    return request;
  } catch (error) {
    return mapThreadBuildError(error);
  }
}

async function loadJob(repository: ThreadBuildJobRepository, jobId: ThreadBuildJobId) {
  try {
    const job = await repository.get(jobId);
    if (!job)
      throw new RuntimeError(
        404,
        'THREAD_BUILD_JOB_NOT_FOUND',
        'The Thread build job was not found.',
      );
    return job;
  } catch (error) {
    return mapThreadBuildError(error);
  }
}

export function registerThreadBuildJobRoutes(
  app: FastifyInstance,
  requests: ThreadRequestRepository,
  jobs: ThreadBuildJobRepository,
  artifacts: ThreadArtifactRepository,
  releases?: ThreadReleaseRepository,
) {
  app.get('/api/thread/v1/build-jobs', async (request) => {
    threadActor(request, 'read');
    try {
      const items = await jobs.list();
      return { items, total: items.length };
    } catch (error) {
      return mapThreadBuildError(error);
    }
  });

  app.get('/api/thread/v1/workbench', async (request) => {
    const actor = threadActor(request, 'read');
    try {
      const [requestItems, jobItems, artifactItems, releaseItems] = await Promise.all([
        requests.list(),
        jobs.list(),
        artifacts.list(),
        releases ? releases.list() : Promise.resolve([]),
      ]);
      const items = buildThreadWorkbench(requestItems, jobItems, artifactItems, actor, releaseItems);
      return { actor, items, total: items.length };
    } catch (error) {
      return mapThreadBuildError(error);
    }
  });

  app.post<{
    Params: { requestId: ThreadRequestId };
    Body: { jobId: ThreadBuildJobId };
  }>(
    '/api/thread/v1/requests/:requestId/build-jobs',
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
          required: ['jobId'],
          properties: { jobId: jobIdSchema },
        },
      },
    },
    async (request, reply) => {
      const actor = threadActor(request, 'write');
      const source = await loadRequest(requests, request.params.requestId);
      try {
        const created = createThreadBuildJob(
          request.body.jobId,
          source,
          actor,
          timestampAfter(source.updatedAt),
        );
        await jobs.save(created);
        return reply.code(201).send(created);
      } catch (error) {
        return mapThreadBuildError(error);
      }
    },
  );

  app.post<{ Params: { jobId: ThreadBuildJobId } }>(
    '/api/thread/v1/build-jobs/:jobId/claim',
    { schema: { params: jobParamsSchema } },
    async (request) => {
      const actor = threadActor(request, 'write');
      const current = await loadJob(jobs, request.params.jobId);
      try {
        const updated = claimThreadBuildJob(current, actor, timestampAfter(current.updatedAt));
        return await jobs.save(updated, current.updatedAt);
      } catch (error) {
        return mapThreadBuildError(error);
      }
    },
  );

  app.post<{ Params: { jobId: ThreadBuildJobId }; Body: NewThreadBuildSubmission }>(
    '/api/thread/v1/build-jobs/:jobId/submit',
    {
      schema: {
        params: jobParamsSchema,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['candidate', 'tests'],
          properties: {
            candidate: candidateSchema,
            tests: {
              type: 'object',
              additionalProperties: false,
              required: ['result', 'artifactId'],
              properties: {
                result: { type: 'string', enum: ['passed', 'failed'] },
                artifactId: { type: 'string', pattern: '^[a-z0-9][a-z0-9._:-]{0,159}$' },
              },
            },
          },
        },
      },
    },
    async (request) => {
      const actor = threadActor(request, 'write');
      const current = await loadJob(jobs, request.params.jobId);
      const source = await loadRequest(requests, current.requestId);
      try {
        const updated = submitThreadBuildJob(
          current,
          source,
          request.body,
          actor,
          timestampAfter(current.updatedAt, source.updatedAt),
        );
        return await jobs.save(updated, current.updatedAt);
      } catch (error) {
        return mapThreadBuildError(error);
      }
    },
  );

  app.post<{ Params: { jobId: ThreadBuildJobId } }>(
    '/api/thread/v1/build-jobs/:jobId/attach',
    { schema: { params: jobParamsSchema } },
    async (request) => {
      const actor = threadActor(request, 'write');
      const currentJob = await loadJob(jobs, request.params.jobId);
      const currentRequest = await loadRequest(requests, currentJob.requestId);
      try {
        const artifact = await artifacts.getVerifiedByJob(currentJob.jobId);
        if (!artifact)
          throw new RuntimeError(
            409,
            'THREAD_ARTIFACT_REQUIRED',
            'A verified Thread artifact is required before attachment.',
          );
        if (currentJob.status === 'attached')
          return { job: currentJob, request: currentRequest, artifact };
        const result = attachThreadBuildJob(
          currentJob,
          currentRequest,
          actor,
          timestampAfter(currentJob.updatedAt, currentRequest.updatedAt),
        );
        if (result.request.updatedAt !== currentRequest.updatedAt)
          await requests.save(result.request, currentRequest.updatedAt);
        await jobs.save(result.job, currentJob.updatedAt);
        return { ...result, artifact };
      } catch (error) {
        return mapThreadBuildError(error);
      }
    },
  );
}
