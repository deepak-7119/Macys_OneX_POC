import type { FastifyInstance, FastifyRequest } from 'fastify';
import { requireCapability } from '../../bobbin/server/authorization.ts';
import { RuntimeError } from '../../bobbin/server/errors.ts';
import type { ThreadActorRole } from '../inventory/contracts.ts';
import type { ThreadBuildJobId } from '../jobs/contracts.ts';
import { ThreadBuildJobDataError, type ThreadBuildJobRepository } from '../jobs/repository.ts';
import type {
  NewThreadArtifact,
  ThreadArtifactId,
  ThreadArtifactVerification,
} from './contracts.ts';
import {
  ThreadArtifactConflictError,
  ThreadArtifactDataError,
  type ThreadArtifactRepository,
} from './repository.ts';
import { stageThreadArtifact, verifyThreadArtifact } from './workflow.ts';

const jobIdSchema = {
  type: 'string',
  pattern: '^thread\\.build-job\\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*$',
} as const;
const artifactIdSchema = {
  type: 'string',
  pattern: '^thread\\.artifact\\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*$',
} as const;
const evidenceIdSchema = {
  type: 'string',
  pattern: '^[a-z0-9][a-z0-9._:-]{0,159}$',
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

function mapArtifactError(error: unknown): never {
  if (error instanceof RuntimeError) throw error;
  if (error instanceof ThreadArtifactConflictError)
    throw new RuntimeError(409, 'THREAD_ARTIFACT_CONFLICT', error.message);
  if (error instanceof ThreadArtifactDataError || error instanceof ThreadBuildJobDataError)
    throw new RuntimeError(
      503,
      'THREAD_REPOSITORY_UNAVAILABLE',
      'A Thread workflow repository could not be read safely.',
    );
  const message = error instanceof Error ? error.message : 'Thread artifact operation failed.';
  if (/not allowed for|claiming role/.test(message))
    throw new RuntimeError(403, 'THREAD_ROLE_FORBIDDEN', message);
  if (/Only a |requires|already has|already exists|changed|missing|terminal/.test(message))
    throw new RuntimeError(409, 'THREAD_ARTIFACT_CONFLICT', message);
  throw new RuntimeError(400, 'THREAD_ARTIFACT_INVALID', message);
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
    return mapArtifactError(error);
  }
}

async function loadArtifact(repository: ThreadArtifactRepository, artifactId: ThreadArtifactId) {
  try {
    const artifact = await repository.get(artifactId);
    if (!artifact)
      throw new RuntimeError(
        404,
        'THREAD_ARTIFACT_NOT_FOUND',
        'The Thread artifact was not found.',
      );
    return artifact;
  } catch (error) {
    return mapArtifactError(error);
  }
}

const verificationGateSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['result', 'artifactId'],
  properties: {
    result: { type: 'string', enum: ['passed', 'failed'] },
    artifactId: evidenceIdSchema,
  },
} as const;

export function registerThreadArtifactRoutes(
  app: FastifyInstance,
  jobs: ThreadBuildJobRepository,
  artifacts: ThreadArtifactRepository,
) {
  app.get('/api/thread/v1/artifacts', async (request) => {
    threadActor(request, 'read');
    try {
      const items = await artifacts.list();
      return { items, total: items.length };
    } catch (error) {
      return mapArtifactError(error);
    }
  });

  app.post<{ Params: { jobId: ThreadBuildJobId }; Body: NewThreadArtifact }>(
    '/api/thread/v1/build-jobs/:jobId/artifacts',
    {
      schema: {
        params: {
          type: 'object',
          additionalProperties: false,
          required: ['jobId'],
          properties: { jobId: jobIdSchema },
        },
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['artifactId', 'content', 'sourceEvidence'],
          properties: {
            artifactId: artifactIdSchema,
            content: {
              type: 'object',
              additionalProperties: false,
              required: ['sha256', 'sizeBytes', 'mediaType'],
              properties: {
                sha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
                sizeBytes: { type: 'integer', minimum: 1, maximum: 10 * 1024 * 1024 },
                mediaType: { const: 'application/gzip' },
              },
            },
            sourceEvidence: {
              type: 'object',
              additionalProperties: false,
              required: ['buildLogArtifactId', 'sbomArtifactId'],
              properties: {
                buildLogArtifactId: evidenceIdSchema,
                sbomArtifactId: evidenceIdSchema,
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const actor = threadActor(request, 'write');
      const job = await loadJob(jobs, request.params.jobId);
      try {
        const latest = await artifacts.getLatestByJob(job.jobId);
        const staged = stageThreadArtifact(
          job,
          request.body,
          actor,
          timestampAfter(job.updatedAt, ...(latest ? [latest.updatedAt] : [])),
        );
        await artifacts.save(staged);
        return reply.code(201).send(staged);
      } catch (error) {
        return mapArtifactError(error);
      }
    },
  );

  app.post<{
    Params: { artifactId: ThreadArtifactId };
    Body: ThreadArtifactVerification;
  }>(
    '/api/thread/v1/artifacts/:artifactId/verify',
    {
      schema: {
        params: {
          type: 'object',
          additionalProperties: false,
          required: ['artifactId'],
          properties: { artifactId: artifactIdSchema },
        },
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['provenance', 'dependencyAudit', 'licenseReview'],
          properties: {
            provenance: verificationGateSchema,
            dependencyAudit: verificationGateSchema,
            licenseReview: verificationGateSchema,
          },
        },
      },
    },
    async (request) => {
      const actor = threadActor(request, 'write');
      const current = await loadArtifact(artifacts, request.params.artifactId);
      try {
        const updated = verifyThreadArtifact(
          current,
          request.body,
          actor,
          timestampAfter(current.updatedAt),
        );
        return await artifacts.save(updated, current.updatedAt);
      } catch (error) {
        return mapArtifactError(error);
      }
    },
  );
}
