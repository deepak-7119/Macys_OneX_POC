import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ThreadObjectId } from '../inventory/contracts.ts';
import type { ThreadRequestId } from '../pipeline/contracts.ts';
import type { ThreadReleaseId, ThreadReleaseRecord } from './contracts.ts';
import { validateThreadRelease } from './validation.ts';

const SCHEMA_VERSION = 1;
const MAX_RELEASES = 1000;
const MAX_FILE_BYTES = 4 * 1024 * 1024;

interface RepositoryEnvelope {
  schemaVersion: 1;
  releases: ThreadReleaseRecord[];
}

export interface ThreadReleaseRepository {
  list(): Promise<ThreadReleaseRecord[]>;
  get(releaseId: ThreadReleaseId): Promise<ThreadReleaseRecord | undefined>;
  getByRequest(requestId: ThreadRequestId): Promise<ThreadReleaseRecord | undefined>;
  getByObjectId(objectId: ThreadObjectId): Promise<ThreadReleaseRecord | undefined>;
  save(release: ThreadReleaseRecord, expectedUpdatedAt?: string): Promise<ThreadReleaseRecord>;
}

export class ThreadReleaseConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ThreadReleaseConflictError';
  }
}

export class ThreadReleaseDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ThreadReleaseDataError';
  }
}

function cloneRelease(release: ThreadReleaseRecord) {
  return validateThreadRelease(release);
}

function validateEnvelope(value: unknown): RepositoryEnvelope {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ThreadReleaseDataError('Thread release repository must contain an object.');
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).some((key) => !['schemaVersion', 'releases'].includes(key)) ||
    record.schemaVersion !== SCHEMA_VERSION ||
    !Array.isArray(record.releases) ||
    record.releases.length > MAX_RELEASES
  )
    throw new ThreadReleaseDataError('Thread release repository schema is invalid.');
  let releases: ThreadReleaseRecord[];
  try {
    releases = record.releases.map(validateThreadRelease);
  } catch {
    throw new ThreadReleaseDataError('Thread release repository contains an invalid record.');
  }
  for (const values of [
    releases.map((item) => item.releaseId),
    releases.map((item) => item.requestId),
    releases.map((item) => item.jobId),
    releases.map((item) => item.artifactId),
    releases.map((item) => item.component.objectId),
    releases.map((item) => item.component.name),
  ]) {
    if (new Set(values).size !== values.length)
      throw new ThreadReleaseDataError('Thread release repository contains duplicate identities.');
  }
  return { schemaVersion: SCHEMA_VERSION, releases };
}

function immutableIdentity(release: ThreadReleaseRecord) {
  const component = release.component;
  return JSON.stringify({
    releaseId: release.releaseId,
    requestId: release.requestId,
    jobId: release.jobId,
    artifactId: release.artifactId,
    component: {
      objectId: component.objectId,
      name: component.name,
      description: component.description,
      category: component.category,
      owner: component.owner,
      currentVersion: component.currentVersion,
      versions: component.versions.map((version) => ({
        version: version.version,
        code: version.code,
        figma: version.figma,
        quality: version.quality,
        createdAt: version.createdAt,
        approvedAt: version.approvedAt,
      })),
      createdAt: component.createdAt,
    },
    artifactContent: release.artifactContent,
    promotedBy: release.promotedBy,
    createdAt: release.createdAt,
  });
}

function saveInto(
  releases: ThreadReleaseRecord[],
  source: ThreadReleaseRecord,
  expectedUpdatedAt?: string,
) {
  const release = cloneRelease(source);
  const index = releases.findIndex((item) => item.releaseId === release.releaseId);
  const identityConflict = releases.find(
    (item) =>
      item.releaseId !== release.releaseId &&
      (item.requestId === release.requestId ||
        item.jobId === release.jobId ||
        item.artifactId === release.artifactId ||
        item.component.objectId === release.component.objectId ||
        item.component.name === release.component.name),
  );
  if (identityConflict)
    throw new ThreadReleaseConflictError('A Thread release already reserves this source or component identity.');
  if (expectedUpdatedAt === undefined && index >= 0)
    throw new ThreadReleaseConflictError('The Thread release already exists.');
  if (expectedUpdatedAt !== undefined) {
    if (index < 0) throw new ThreadReleaseConflictError('The Thread release is missing.');
    const existing = releases[index];
    if (existing.updatedAt !== expectedUpdatedAt)
      throw new ThreadReleaseConflictError('The Thread release changed since it was loaded.');
    if (release.updatedAt <= expectedUpdatedAt)
      throw new ThreadReleaseConflictError('The Thread release update must advance its timestamp.');
    if (existing.status !== 'active')
      throw new ThreadReleaseConflictError('A rolled-back Thread release cannot be changed.');
    if (immutableIdentity(existing) !== immutableIdentity(release))
      throw new ThreadReleaseConflictError('Thread release identity is immutable.');
  }
  const next = releases.map(cloneRelease);
  if (index < 0) {
    if (next.length >= MAX_RELEASES)
      throw new ThreadReleaseConflictError('The Thread release repository is full.');
    next.push(release);
  } else next[index] = release;
  return next;
}

export class InMemoryThreadReleaseRepository implements ThreadReleaseRepository {
  #releases: ThreadReleaseRecord[];

  constructor(seed: ThreadReleaseRecord[] = []) {
    this.#releases = validateEnvelope({ schemaVersion: SCHEMA_VERSION, releases: seed }).releases;
  }
  async list() { return this.#releases.map(cloneRelease); }
  async get(releaseId: ThreadReleaseId) {
    const release = this.#releases.find((item) => item.releaseId === releaseId);
    return release ? cloneRelease(release) : undefined;
  }
  async getByRequest(requestId: ThreadRequestId) {
    const release = this.#releases.find((item) => item.requestId === requestId);
    return release ? cloneRelease(release) : undefined;
  }
  async getByObjectId(objectId: ThreadObjectId) {
    const release = this.#releases.find((item) => item.component.objectId === objectId);
    return release ? cloneRelease(release) : undefined;
  }
  async save(release: ThreadReleaseRecord, expectedUpdatedAt?: string) {
    this.#releases = saveInto(this.#releases, release, expectedUpdatedAt);
    return cloneRelease(release);
  }
}

export class FileThreadReleaseRepository implements ThreadReleaseRepository {
  readonly #path: string;
  readonly #backupPath: string;
  #queue: Promise<unknown> = Promise.resolve();

  constructor(path: string) {
    if (!path || !path.toLowerCase().endsWith('.json'))
      throw new Error('Thread release repository path must be an explicit JSON file.');
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
        const empty: RepositoryEnvelope = { schemaVersion: SCHEMA_VERSION, releases: [] };
        await writeFile(this.#path, `${JSON.stringify(empty, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
        return empty;
      }
    }
    try { return validateEnvelope(JSON.parse(contents)); } catch (error) {
      if (error instanceof ThreadReleaseDataError) throw error;
      throw new ThreadReleaseDataError('Thread release repository is not valid JSON.');
    }
  }
  async #readBoundedFile() {
    const metadata = await stat(this.#path);
    if (metadata.size > MAX_FILE_BYTES)
      throw new ThreadReleaseDataError('Thread release repository exceeds its size limit.');
    return readFile(this.#path, 'utf8');
  }
  async #write(envelope: RepositoryEnvelope) {
    const validated = validateEnvelope(envelope);
    const temporaryPath = `${this.#path}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(validated, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    let backedUp = false;
    try {
      try { await unlink(this.#backupPath); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      try { await rename(this.#path, this.#backupPath); backedUp = true; } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      await rename(temporaryPath, this.#path);
      if (backedUp) try { await unlink(this.#backupPath); } catch {}
    } catch (error) {
      try { await unlink(temporaryPath); } catch {}
      if (backedUp) try { await rename(this.#backupPath, this.#path); } catch {}
      throw error;
    }
  }
  #serialized<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#queue.then(operation, operation);
    this.#queue = result.then(() => undefined, () => undefined);
    return result;
  }
  async list() { return this.#serialized(async () => (await this.#read()).releases.map(cloneRelease)); }
  async get(releaseId: ThreadReleaseId) {
    return this.#serialized(async () => {
      const item = (await this.#read()).releases.find((release) => release.releaseId === releaseId);
      return item ? cloneRelease(item) : undefined;
    });
  }
  async getByRequest(requestId: ThreadRequestId) {
    return this.#serialized(async () => {
      const item = (await this.#read()).releases.find((release) => release.requestId === requestId);
      return item ? cloneRelease(item) : undefined;
    });
  }
  async getByObjectId(objectId: ThreadObjectId) {
    return this.#serialized(async () => {
      const item = (await this.#read()).releases.find((release) => release.component.objectId === objectId);
      return item ? cloneRelease(item) : undefined;
    });
  }
  async save(release: ThreadReleaseRecord, expectedUpdatedAt?: string) {
    return this.#serialized(async () => {
      const envelope = await this.#read();
      const releases = saveInto(envelope.releases, release, expectedUpdatedAt);
      await this.#write({ schemaVersion: SCHEMA_VERSION, releases });
      return cloneRelease(release);
    });
  }
}
