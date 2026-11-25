import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ThreadRequestId } from '../pipeline/contracts.ts';
import type { ThreadBuildJob, ThreadBuildJobId } from './contracts.ts';
import { validateThreadBuildJob } from './validation.ts';

const SCHEMA_VERSION = 1;
const MAX_JOBS = 1000;
const MAX_FILE_BYTES = 2 * 1024 * 1024;

interface RepositoryEnvelope {
  schemaVersion: 1;
  jobs: ThreadBuildJob[];
}

export interface ThreadBuildJobRepository {
  list(): Promise<ThreadBuildJob[]>;
  get(jobId: ThreadBuildJobId): Promise<ThreadBuildJob | undefined>;
  getByRequest(requestId: ThreadRequestId): Promise<ThreadBuildJob | undefined>;
  save(job: ThreadBuildJob, expectedUpdatedAt?: string): Promise<ThreadBuildJob>;
}

export class ThreadBuildJobConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ThreadBuildJobConflictError';
  }
}

export class ThreadBuildJobDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ThreadBuildJobDataError';
  }
}

function cloneJob(job: ThreadBuildJob): ThreadBuildJob {
  return validateThreadBuildJob(job);
}

function validateEnvelope(value: unknown): RepositoryEnvelope {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ThreadBuildJobDataError('Thread build-job repository must contain an object.');
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).some((key) => !['schemaVersion', 'jobs'].includes(key)) ||
    record.schemaVersion !== SCHEMA_VERSION ||
    !Array.isArray(record.jobs) ||
    record.jobs.length > MAX_JOBS
  )
    throw new ThreadBuildJobDataError('Thread build-job repository schema is invalid.');
  let jobs: ThreadBuildJob[];
  try {
    jobs = record.jobs.map(validateThreadBuildJob);
  } catch {
    throw new ThreadBuildJobDataError('Thread build-job repository contains an invalid record.');
  }
  if (new Set(jobs.map((job) => job.jobId)).size !== jobs.length)
    throw new ThreadBuildJobDataError('Thread build-job repository contains duplicate job IDs.');
  if (new Set(jobs.map((job) => job.requestId)).size !== jobs.length)
    throw new ThreadBuildJobDataError(
      'Thread build-job repository contains duplicate request IDs.',
    );
  return { schemaVersion: SCHEMA_VERSION, jobs };
}

function saveInto(
  jobs: ThreadBuildJob[],
  source: ThreadBuildJob,
  expectedUpdatedAt?: string,
): ThreadBuildJob[] {
  const job = cloneJob(source);
  const existingIndex = jobs.findIndex((item) => item.jobId === job.jobId);
  const requestConflict = jobs.find(
    (item) => item.requestId === job.requestId && item.jobId !== job.jobId,
  );
  if (requestConflict)
    throw new ThreadBuildJobConflictError('A build job already exists for this Thread request.');
  if (expectedUpdatedAt === undefined && existingIndex >= 0)
    throw new ThreadBuildJobConflictError('The Thread build job already exists.');
  if (expectedUpdatedAt !== undefined) {
    if (existingIndex < 0)
      throw new ThreadBuildJobConflictError('The Thread build job is missing.');
    if (jobs[existingIndex].updatedAt !== expectedUpdatedAt)
      throw new ThreadBuildJobConflictError('The Thread build job changed since it was loaded.');
    if (job.updatedAt <= expectedUpdatedAt)
      throw new ThreadBuildJobConflictError(
        'The Thread build-job update must advance its concurrency timestamp.',
      );
  }
  const next = jobs.map(cloneJob);
  if (existingIndex < 0) {
    if (next.length >= MAX_JOBS)
      throw new ThreadBuildJobConflictError('The Thread build-job repository is full.');
    next.push(job);
  } else {
    next[existingIndex] = job;
  }
  return next;
}

export class InMemoryThreadBuildJobRepository implements ThreadBuildJobRepository {
  #jobs: ThreadBuildJob[];

  constructor(seed: ThreadBuildJob[] = []) {
    this.#jobs = validateEnvelope({ schemaVersion: SCHEMA_VERSION, jobs: seed }).jobs;
  }

  async list(): Promise<ThreadBuildJob[]> {
    return this.#jobs.map(cloneJob);
  }

  async get(jobId: ThreadBuildJobId): Promise<ThreadBuildJob | undefined> {
    const job = this.#jobs.find((item) => item.jobId === jobId);
    return job ? cloneJob(job) : undefined;
  }

  async getByRequest(requestId: ThreadRequestId): Promise<ThreadBuildJob | undefined> {
    const job = this.#jobs.find((item) => item.requestId === requestId);
    return job ? cloneJob(job) : undefined;
  }

  async save(job: ThreadBuildJob, expectedUpdatedAt?: string): Promise<ThreadBuildJob> {
    this.#jobs = saveInto(this.#jobs, job, expectedUpdatedAt);
    return cloneJob(job);
  }
}

export class FileThreadBuildJobRepository implements ThreadBuildJobRepository {
  readonly #path: string;
  readonly #backupPath: string;
  #queue: Promise<unknown> = Promise.resolve();

  constructor(path: string) {
    if (!path || !path.toLowerCase().endsWith('.json'))
      throw new Error('Thread build-job repository path must be an explicit JSON file.');
    this.#path = path;
    this.#backupPath = `${path}.backup`;
  }

  async #read(): Promise<RepositoryEnvelope> {
    await mkdir(dirname(this.#path), { recursive: true });
    let contents: string;
    try {
      contents = await this.#readBoundedFile();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      try {
        await rename(this.#backupPath, this.#path);
        contents = await this.#readBoundedFile();
      } catch (backupError) {
        if ((backupError as NodeJS.ErrnoException).code !== 'ENOENT') throw backupError;
        const empty: RepositoryEnvelope = { schemaVersion: SCHEMA_VERSION, jobs: [] };
        await writeFile(this.#path, `${JSON.stringify(empty, null, 2)}\n`, {
          encoding: 'utf8',
          flag: 'wx',
        });
        return empty;
      }
    }
    try {
      return validateEnvelope(JSON.parse(contents));
    } catch (error) {
      if (error instanceof ThreadBuildJobDataError) throw error;
      throw new ThreadBuildJobDataError('Thread build-job repository is not valid JSON.');
    }
  }

  async #readBoundedFile(): Promise<string> {
    const metadata = await stat(this.#path);
    if (metadata.size > MAX_FILE_BYTES)
      throw new ThreadBuildJobDataError('Thread build-job repository exceeds its size limit.');
    return readFile(this.#path, 'utf8');
  }

  async #write(envelope: RepositoryEnvelope): Promise<void> {
    const validated = validateEnvelope(envelope);
    const temporaryPath = `${this.#path}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(validated, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
    });
    let backedUp = false;
    try {
      try {
        await unlink(this.#backupPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      try {
        await rename(this.#path, this.#backupPath);
        backedUp = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      await rename(temporaryPath, this.#path);
      if (backedUp) {
        try {
          await unlink(this.#backupPath);
        } catch {
          // A validated primary is committed; the exact sibling is safe to retain.
        }
      }
    } catch (error) {
      try {
        await unlink(temporaryPath);
      } catch {}
      if (backedUp) {
        try {
          await rename(this.#backupPath, this.#path);
        } catch {}
      }
      throw error;
    }
  }

  #serialized<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#queue.then(operation, operation);
    this.#queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async list(): Promise<ThreadBuildJob[]> {
    return this.#serialized(async () => (await this.#read()).jobs.map(cloneJob));
  }

  async get(jobId: ThreadBuildJobId): Promise<ThreadBuildJob | undefined> {
    return this.#serialized(async () => {
      const job = (await this.#read()).jobs.find((item) => item.jobId === jobId);
      return job ? cloneJob(job) : undefined;
    });
  }

  async getByRequest(requestId: ThreadRequestId): Promise<ThreadBuildJob | undefined> {
    return this.#serialized(async () => {
      const job = (await this.#read()).jobs.find((item) => item.requestId === requestId);
      return job ? cloneJob(job) : undefined;
    });
  }

  async save(job: ThreadBuildJob, expectedUpdatedAt?: string): Promise<ThreadBuildJob> {
    return this.#serialized(async () => {
      const envelope = await this.#read();
      const jobs = saveInto(envelope.jobs, job, expectedUpdatedAt);
      await this.#write({ schemaVersion: SCHEMA_VERSION, jobs });
      return cloneJob(job);
    });
  }
}
