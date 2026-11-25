import type { FastifyInstance, FastifyRequest } from 'fastify';
import { requireCapability } from '../../bobbin/server/authorization.ts';
import { RuntimeError } from '../../bobbin/server/errors.ts';
import { ThreadArtifactDataError, type ThreadArtifactRepository } from '../artifacts/repository.ts';
import type { ThreadActorRole } from '../inventory/contracts.ts';
import { ThreadBuildJobDataError, type ThreadBuildJobRepository } from '../jobs/repository.ts';
import type { ThreadRequestId } from '../pipeline/contracts.ts';
import { ThreadRepositoryDataError, type ThreadRequestRepository } from '../pipeline/repository.ts';
import type {
  NewThreadRelease,
  ThreadReleaseId,
  ThreadReleaseRollbackInput,
} from './contracts.ts';
import {
  ThreadReleaseConflictError,
  ThreadReleaseDataError,
  type ThreadReleaseRepository,
} from './repository.ts';
import { promoteThreadRelease, rollbackThreadRelease } from './workflow.ts';

const requestIdSchema = {
  type: 'string',
  pattern: '^thread\\.request\\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*$',
} as const;
const releaseIdSchema = {
  type: 'string',
  pattern: '^thread\\.release\\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*$',
} as const;

function timestampAfter(...previous: string[]) {
  return new Date(Math.max(Date.now(), ...previous.map((item) => Date.parse(item) + 1))).toISOString();
}

function threadActor(request: FastifyRequest, capability: 'read' | 'write'): ThreadActorRole {
  const session = requireCapability(request, `thread:requests:${capability}`);
  if (!session.threadActor)
    throw new RuntimeError(403, 'THREAD_ROLE_FORBIDDEN', 'This synthetic identity has no Thread workflow role.');
  return session.threadActor;
}

function mapReleaseError(error: unknown): never {
  if (error instanceof RuntimeError) throw error;
  if (error instanceof ThreadReleaseConflictError)
    throw new RuntimeError(409, 'THREAD_RELEASE_CONFLICT', error.message);
  if (
    error instanceof ThreadReleaseDataError ||
    error instanceof ThreadRepositoryDataError ||
    error instanceof ThreadBuildJobDataError ||
    error instanceof ThreadArtifactDataError
  )
    throw new RuntimeError(503, 'THREAD_REPOSITORY_UNAVAILABLE', 'A Thread workflow repository could not be read safely.');
  const message = error instanceof Error ? error.message : 'Thread release operation failed.';
  if (/not allowed for/.test(message))
    throw new RuntimeError(403, 'THREAD_ROLE_FORBIDDEN', message);
  if (/requires|already|Only an active|identities do not|identity does not|timestamp must/.test(message))
    throw new RuntimeError(409, 'THREAD_RELEASE_CONFLICT', message);
  throw new RuntimeError(400, 'THREAD_RELEASE_INVALID', message);
}

export function registerThreadReleaseRoutes(
  app: FastifyInstance,
  requests: ThreadRequestRepository,
  jobs: ThreadBuildJobRepository,
  artifacts: ThreadArtifactRepository,
  releases: ThreadReleaseRepository,
) {
  app.get('/api/thread/v1/releases', async (request) => {
    threadActor(request, 'read');
    try {
      const items = await releases.list();
      return { items, total: items.length };
    } catch (error) {
      return mapReleaseError(error);
    }
  });

  app.post<{
    Params: { requestId: ThreadRequestId };
    Body: NewThreadRelease;
  }>(
    '/api/thread/v1/requests/:requestId/releases',
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
          required: ['releaseId'],
          properties: { releaseId: releaseIdSchema },
        },
      },
    },
    async (request, reply) => {
      requireCapability(request, 'thread:governance:approve');
      const actor = threadActor(request, 'write');
      try {
        const componentRequest = await requests.get(request.params.requestId);
        if (!componentRequest)
          throw new RuntimeError(404, 'THREAD_REQUEST_NOT_FOUND', 'The Thread request was not found.');
        const job = await jobs.getByRequest(componentRequest.requestId);
        if (!job)
          throw new RuntimeError(404, 'THREAD_BUILD_JOB_NOT_FOUND', 'The Thread build job was not found.');
        const artifact = await artifacts.getVerifiedByJob(job.jobId);
        if (!artifact)
          throw new RuntimeError(409, 'THREAD_ARTIFACT_REQUIRED', 'A verified Thread artifact is required.');
        const release = promoteThreadRelease(
          request.body.releaseId,
          componentRequest,
          job,
          artifact,
          actor,
          timestampAfter(componentRequest.updatedAt, job.updatedAt, artifact.updatedAt),
        );
        await releases.save(release);
        return reply.code(201).send(release);
      } catch (error) {
        return mapReleaseError(error);
      }
    },
  );

  app.post<{
    Params: { releaseId: ThreadReleaseId };
    Body: ThreadReleaseRollbackInput;
  }>(
    '/api/thread/v1/releases/:releaseId/rollback',
    {
      schema: {
        params: {
          type: 'object',
          additionalProperties: false,
          required: ['releaseId'],
          properties: { releaseId: releaseIdSchema },
        },
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['reason', 'evidenceId'],
          properties: {
            reason: { type: 'string', minLength: 10, maxLength: 300 },
            evidenceId: { type: 'string', pattern: '^[a-z0-9][a-z0-9._:-]{0,159}$' },
          },
        },
      },
    },
    async (request) => {
      requireCapability(request, 'thread:governance:approve');
      const actor = threadActor(request, 'write');
      try {
        const current = await releases.get(request.params.releaseId);
        if (!current)
          throw new RuntimeError(404, 'THREAD_RELEASE_NOT_FOUND', 'The Thread release was not found.');
        const rolledBack = rollbackThreadRelease(
          current,
          request.body,
          actor,
          timestampAfter(current.updatedAt),
        );
        return await releases.save(rolledBack, current.updatedAt);
      } catch (error) {
        return mapReleaseError(error);
      }
    },
  );
}
