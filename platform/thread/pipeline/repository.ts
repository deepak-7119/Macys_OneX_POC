import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ThreadComponentRequest, ThreadRequestId } from './contracts.ts';
import { validateThreadComponentRequest } from './workflow.ts';

const SCHEMA_VERSION = 1;
const MAX_REQUESTS = 1000;
const MAX_FILE_BYTES = 2 * 1024 * 1024;

interface RepositoryEnvelope {
  schemaVersion: 1;
  requests: ThreadComponentRequest[];
}

export interface ThreadRequestRepository {
  list(): Promise<ThreadComponentRequest[]>;
  get(requestId: ThreadRequestId): Promise<ThreadComponentRequest | undefined>;
  save(
    request: ThreadComponentRequest,
    expectedUpdatedAt?: string,
  ): Promise<ThreadComponentRequest>;
}

export class ThreadRepositoryConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ThreadRepositoryConflictError';
  }
}

export class ThreadRepositoryDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ThreadRepositoryDataError';
  }
}

function cloneRequest(request: ThreadComponentRequest): ThreadComponentRequest {
  return validateThreadComponentRequest(request);
}

function validateEnvelope(value: unknown): RepositoryEnvelope {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ThreadRepositoryDataError('Thread request repository must contain an object.');
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).some((key) => !['schemaVersion', 'requests'].includes(key)) ||
    record.schemaVersion !== SCHEMA_VERSION ||
    !Array.isArray(record.requests) ||
    record.requests.length > MAX_REQUESTS
  )
    throw new ThreadRepositoryDataError('Thread request repository schema is invalid.');
  let requests: ThreadComponentRequest[];
  try {
    requests = record.requests.map(validateThreadComponentRequest);
  } catch {
    throw new ThreadRepositoryDataError('Thread request repository contains an invalid record.');
  }
  if (new Set(requests.map((request) => request.requestId)).size !== requests.length)
    throw new ThreadRepositoryDataError(
      'Thread request repository contains duplicate request IDs.',
    );
  if (new Set(requests.map((request) => request.objectId)).size !== requests.length)
    throw new ThreadRepositoryDataError('Thread request repository contains duplicate object IDs.');
  return { schemaVersion: SCHEMA_VERSION, requests };
}

function saveInto(
  requests: ThreadComponentRequest[],
  source: ThreadComponentRequest,
  expectedUpdatedAt?: string,
): ThreadComponentRequest[] {
  const request = cloneRequest(source);
  const existingIndex = requests.findIndex((item) => item.requestId === request.requestId);
  const objectConflict = requests.find(
    (item) => item.objectId === request.objectId && item.requestId !== request.requestId,
  );
  if (objectConflict)
    throw new ThreadRepositoryConflictError('A request already reserves this Thread object ID.');
  if (expectedUpdatedAt === undefined && existingIndex >= 0)
    throw new ThreadRepositoryConflictError('The Thread request already exists.');
  if (expectedUpdatedAt !== undefined) {
    if (existingIndex < 0)
      throw new ThreadRepositoryConflictError('The Thread request is missing.');
    if (requests[existingIndex].updatedAt !== expectedUpdatedAt)
      throw new ThreadRepositoryConflictError('The Thread request changed since it was loaded.');
    if (request.updatedAt <= expectedUpdatedAt)
      throw new ThreadRepositoryConflictError(
        'The Thread request update must advance its concurrency timestamp.',
      );
  }
  const next = requests.map(cloneRequest);
  if (existingIndex < 0) {
    if (next.length >= MAX_REQUESTS)
      throw new ThreadRepositoryConflictError('The Thread request repository is full.');
    next.push(request);
  } else {
    next[existingIndex] = request;
  }
  return next;
}

export class InMemoryThreadRequestRepository implements ThreadRequestRepository {
  #requests: ThreadComponentRequest[];

  constructor(seed: ThreadComponentRequest[] = []) {
    this.#requests = validateEnvelope({ schemaVersion: SCHEMA_VERSION, requests: seed }).requests;
  }

  async list(): Promise<ThreadComponentRequest[]> {
    return this.#requests.map(cloneRequest);
  }

  async get(requestId: ThreadRequestId): Promise<ThreadComponentRequest | undefined> {
    const request = this.#requests.find((item) => item.requestId === requestId);
    return request ? cloneRequest(request) : undefined;
  }

  async save(
    request: ThreadComponentRequest,
    expectedUpdatedAt?: string,
  ): Promise<ThreadComponentRequest> {
    this.#requests = saveInto(this.#requests, request, expectedUpdatedAt);
    return cloneRequest(request);
  }
}

export class FileThreadRequestRepository implements ThreadRequestRepository {
  readonly #path: string;
  readonly #backupPath: string;
  #queue: Promise<unknown> = Promise.resolve();

  constructor(path: string) {
    if (!path || !path.toLowerCase().endsWith('.json'))
      throw new Error('Thread request repository path must be an explicit JSON file.');
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
        const empty: RepositoryEnvelope = { schemaVersion: SCHEMA_VERSION, requests: [] };
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
      if (error instanceof ThreadRepositoryDataError) throw error;
      throw new ThreadRepositoryDataError('Thread request repository is not valid JSON.');
    }
  }

  async #readBoundedFile(): Promise<string> {
    const metadata = await stat(this.#path);
    if (metadata.size > MAX_FILE_BYTES)
      throw new ThreadRepositoryDataError('Thread request repository exceeds its size limit.');
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
      // A validated primary file makes an older crash backup stale. Removing that
      // exact sibling prevents Windows rename collisions without widening scope.
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
          // The validated primary is committed. A stale exact sibling backup is
          // safe and will be removed before the next write.
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

  async list(): Promise<ThreadComponentRequest[]> {
    return this.#serialized(async () => (await this.#read()).requests.map(cloneRequest));
  }

  async get(requestId: ThreadRequestId): Promise<ThreadComponentRequest | undefined> {
    return this.#serialized(async () => {
      const request = (await this.#read()).requests.find((item) => item.requestId === requestId);
      return request ? cloneRequest(request) : undefined;
    });
  }

  async save(
    request: ThreadComponentRequest,
    expectedUpdatedAt?: string,
  ): Promise<ThreadComponentRequest> {
    return this.#serialized(async () => {
      const envelope = await this.#read();
      const requests = saveInto(envelope.requests, request, expectedUpdatedAt);
      await this.#write({ schemaVersion: SCHEMA_VERSION, requests });
      return cloneRequest(request);
    });
  }
}
