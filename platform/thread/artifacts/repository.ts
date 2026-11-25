import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ThreadBuildJobId } from '../jobs/contracts.ts';
import type { ThreadArtifactId, ThreadArtifactRecord } from './contracts.ts';
import { validateThreadArtifact } from './validation.ts';

const SCHEMA_VERSION = 1;
const MAX_ARTIFACTS = 2000;
const MAX_FILE_BYTES = 4 * 1024 * 1024;

interface RepositoryEnvelope {
  schemaVersion: 1;
  artifacts: ThreadArtifactRecord[];
}

export interface ThreadArtifactRepository {
  list(): Promise<ThreadArtifactRecord[]>;
  get(artifactId: ThreadArtifactId): Promise<ThreadArtifactRecord | undefined>;
  listByJob(jobId: ThreadBuildJobId): Promise<ThreadArtifactRecord[]>;
  getLatestByJob(jobId: ThreadBuildJobId): Promise<ThreadArtifactRecord | undefined>;
  getVerifiedByJob(jobId: ThreadBuildJobId): Promise<ThreadArtifactRecord | undefined>;
  save(artifact: ThreadArtifactRecord, expectedUpdatedAt?: string): Promise<ThreadArtifactRecord>;
}

export class ThreadArtifactConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ThreadArtifactConflictError';
  }
}

export class ThreadArtifactDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ThreadArtifactDataError';
  }
}

function cloneArtifact(artifact: ThreadArtifactRecord): ThreadArtifactRecord {
  return validateThreadArtifact(artifact);
}

function byCreation(left: ThreadArtifactRecord, right: ThreadArtifactRecord): number {
  return (
    left.createdAt.localeCompare(right.createdAt) || left.artifactId.localeCompare(right.artifactId)
  );
}

function validateEnvelope(value: unknown): RepositoryEnvelope {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ThreadArtifactDataError('Thread artifact repository must contain an object.');
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).some((key) => !['schemaVersion', 'artifacts'].includes(key)) ||
    record.schemaVersion !== SCHEMA_VERSION ||
    !Array.isArray(record.artifacts) ||
    record.artifacts.length > MAX_ARTIFACTS
  )
    throw new ThreadArtifactDataError('Thread artifact repository schema is invalid.');
  let artifacts: ThreadArtifactRecord[];
  try {
    artifacts = record.artifacts.map(validateThreadArtifact);
  } catch {
    throw new ThreadArtifactDataError('Thread artifact repository contains an invalid record.');
  }
  if (new Set(artifacts.map((artifact) => artifact.artifactId)).size !== artifacts.length)
    throw new ThreadArtifactDataError(
      'Thread artifact repository contains duplicate artifact IDs.',
    );
  const activeJobs = artifacts
    .filter((artifact) => artifact.status === 'staged' || artifact.status === 'verified')
    .map((artifact) => artifact.jobId);
  if (new Set(activeJobs).size !== activeJobs.length)
    throw new ThreadArtifactDataError(
      'Thread artifact repository contains multiple active artifacts for one job.',
    );
  return { schemaVersion: SCHEMA_VERSION, artifacts };
}

function immutableIdentity(artifact: ThreadArtifactRecord): string {
  return JSON.stringify({
    artifactId: artifact.artifactId,
    jobId: artifact.jobId,
    requestId: artifact.requestId,
    objectId: artifact.objectId,
    package: artifact.package,
    content: artifact.content,
    sourceEvidence: artifact.sourceEvidence,
    stagedBy: artifact.stagedBy,
    createdAt: artifact.createdAt,
  });
}

function saveInto(
  artifacts: ThreadArtifactRecord[],
  source: ThreadArtifactRecord,
  expectedUpdatedAt?: string,
): ThreadArtifactRecord[] {
  const artifact = cloneArtifact(source);
  const existingIndex = artifacts.findIndex((item) => item.artifactId === artifact.artifactId);
  if (expectedUpdatedAt === undefined && existingIndex >= 0)
    throw new ThreadArtifactConflictError('The Thread artifact already exists.');
  if (expectedUpdatedAt === undefined) {
    const active = artifacts.find(
      (item) =>
        item.jobId === artifact.jobId && (item.status === 'staged' || item.status === 'verified'),
    );
    if (active)
      throw new ThreadArtifactConflictError(
        'This Thread build job already has an active or verified artifact.',
      );
  } else {
    if (existingIndex < 0) throw new ThreadArtifactConflictError('The Thread artifact is missing.');
    const existing = artifacts[existingIndex];
    if (existing.updatedAt !== expectedUpdatedAt)
      throw new ThreadArtifactConflictError('The Thread artifact changed since it was loaded.');
    if (artifact.updatedAt <= expectedUpdatedAt)
      throw new ThreadArtifactConflictError(
        'The Thread artifact update must advance its concurrency timestamp.',
      );
    if (immutableIdentity(existing) !== immutableIdentity(artifact))
      throw new ThreadArtifactConflictError('Thread artifact package identity is immutable.');
    if (existing.status !== 'staged')
      throw new ThreadArtifactConflictError('A terminal Thread artifact cannot be changed.');
  }
  const verifiedConflict = artifacts.find(
    (item) =>
      item.jobId === artifact.jobId &&
      item.status === 'verified' &&
      item.artifactId !== artifact.artifactId,
  );
  if (verifiedConflict)
    throw new ThreadArtifactConflictError('This Thread build job already has a verified artifact.');
  const next = artifacts.map(cloneArtifact);
  if (existingIndex < 0) {
    if (next.length >= MAX_ARTIFACTS)
      throw new ThreadArtifactConflictError('The Thread artifact repository is full.');
    next.push(artifact);
  } else {
    next[existingIndex] = artifact;
  }
  return next;
}

function forJob(artifacts: ThreadArtifactRecord[], jobId: ThreadBuildJobId) {
  return artifacts.filter((artifact) => artifact.jobId === jobId).sort(byCreation);
}

export class InMemoryThreadArtifactRepository implements ThreadArtifactRepository {
  #artifacts: ThreadArtifactRecord[];

  constructor(seed: ThreadArtifactRecord[] = []) {
    this.#artifacts = validateEnvelope({
      schemaVersion: SCHEMA_VERSION,
      artifacts: seed,
    }).artifacts;
  }

  async list(): Promise<ThreadArtifactRecord[]> {
    return this.#artifacts.map(cloneArtifact).sort(byCreation);
  }

  async get(artifactId: ThreadArtifactId): Promise<ThreadArtifactRecord | undefined> {
    const artifact = this.#artifacts.find((item) => item.artifactId === artifactId);
    return artifact ? cloneArtifact(artifact) : undefined;
  }

  async listByJob(jobId: ThreadBuildJobId): Promise<ThreadArtifactRecord[]> {
    return forJob(this.#artifacts, jobId).map(cloneArtifact);
  }

  async getLatestByJob(jobId: ThreadBuildJobId): Promise<ThreadArtifactRecord | undefined> {
    const artifacts = forJob(this.#artifacts, jobId);
    const artifact = artifacts.at(-1);
    return artifact ? cloneArtifact(artifact) : undefined;
  }

  async getVerifiedByJob(jobId: ThreadBuildJobId): Promise<ThreadArtifactRecord | undefined> {
    const artifact = this.#artifacts.find(
      (item) => item.jobId === jobId && item.status === 'verified',
    );
    return artifact ? cloneArtifact(artifact) : undefined;
  }

  async save(
    artifact: ThreadArtifactRecord,
    expectedUpdatedAt?: string,
  ): Promise<ThreadArtifactRecord> {
    this.#artifacts = saveInto(this.#artifacts, artifact, expectedUpdatedAt);
    return cloneArtifact(artifact);
  }
}

export class FileThreadArtifactRepository implements ThreadArtifactRepository {
  readonly #path: string;
  readonly #backupPath: string;
  #queue: Promise<unknown> = Promise.resolve();

  constructor(path: string) {
    if (!path || !path.toLowerCase().endsWith('.json'))
      throw new Error('Thread artifact repository path must be an explicit JSON file.');
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
        const empty: RepositoryEnvelope = { schemaVersion: SCHEMA_VERSION, artifacts: [] };
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
      if (error instanceof ThreadArtifactDataError) throw error;
      throw new ThreadArtifactDataError('Thread artifact repository is not valid JSON.');
    }
  }

  async #readBoundedFile(): Promise<string> {
    const metadata = await stat(this.#path);
    if (metadata.size > MAX_FILE_BYTES)
      throw new ThreadArtifactDataError('Thread artifact repository exceeds its size limit.');
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
          // The validated primary is committed; the exact sibling remains recoverable.
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

  async list(): Promise<ThreadArtifactRecord[]> {
    return this.#serialized(async () =>
      (await this.#read()).artifacts.map(cloneArtifact).sort(byCreation),
    );
  }

  async get(artifactId: ThreadArtifactId): Promise<ThreadArtifactRecord | undefined> {
    return this.#serialized(async () => {
      const artifact = (await this.#read()).artifacts.find(
        (item) => item.artifactId === artifactId,
      );
      return artifact ? cloneArtifact(artifact) : undefined;
    });
  }

  async listByJob(jobId: ThreadBuildJobId): Promise<ThreadArtifactRecord[]> {
    return this.#serialized(async () =>
      forJob((await this.#read()).artifacts, jobId).map(cloneArtifact),
    );
  }

  async getLatestByJob(jobId: ThreadBuildJobId): Promise<ThreadArtifactRecord | undefined> {
    return this.#serialized(async () => {
      const artifact = forJob((await this.#read()).artifacts, jobId).at(-1);
      return artifact ? cloneArtifact(artifact) : undefined;
    });
  }

  async getVerifiedByJob(jobId: ThreadBuildJobId): Promise<ThreadArtifactRecord | undefined> {
    return this.#serialized(async () => {
      const artifact = (await this.#read()).artifacts.find(
        (item) => item.jobId === jobId && item.status === 'verified',
      );
      return artifact ? cloneArtifact(artifact) : undefined;
    });
  }

  async save(
    artifact: ThreadArtifactRecord,
    expectedUpdatedAt?: string,
  ): Promise<ThreadArtifactRecord> {
    return this.#serialized(async () => {
      const envelope = await this.#read();
      const artifacts = saveInto(envelope.artifacts, artifact, expectedUpdatedAt);
      await this.#write({ schemaVersion: SCHEMA_VERSION, artifacts });
      return cloneArtifact(artifact);
    });
  }
}
