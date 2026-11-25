import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ThreadAutomationRun, ThreadAutomationRunId } from './contracts.ts';
import { validateThreadAutomationRun } from './validation.ts';

const SCHEMA_VERSION = 1;
const MAX_RUNS = 1000;
const MAX_FILE_BYTES = 2 * 1024 * 1024;

interface RepositoryEnvelope {
  schemaVersion: 1;
  runs: ThreadAutomationRun[];
}

export interface ThreadAutomationRunRepository {
  list(): Promise<ThreadAutomationRun[]>;
  get(runId: ThreadAutomationRunId): Promise<ThreadAutomationRun | undefined>;
  save(run: ThreadAutomationRun, expectedUpdatedAt?: string): Promise<ThreadAutomationRun>;
}

export class ThreadAutomationRunConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ThreadAutomationRunConflictError';
  }
}

export class ThreadAutomationRunDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ThreadAutomationRunDataError';
  }
}

function cloneRun(run: ThreadAutomationRun): ThreadAutomationRun {
  return validateThreadAutomationRun(run);
}

function validateEnvelope(value: unknown): RepositoryEnvelope {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ThreadAutomationRunDataError('Thread adapter-run repository must contain an object.');
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).some((key) => !['schemaVersion', 'runs'].includes(key)) ||
    record.schemaVersion !== SCHEMA_VERSION ||
    !Array.isArray(record.runs) ||
    record.runs.length > MAX_RUNS
  )
    throw new ThreadAutomationRunDataError('Thread adapter-run repository schema is invalid.');
  let runs: ThreadAutomationRun[];
  try {
    runs = record.runs.map(validateThreadAutomationRun);
  } catch {
    throw new ThreadAutomationRunDataError('Thread adapter-run repository contains an invalid record.');
  }
  if (new Set(runs.map((run) => run.runId)).size !== runs.length)
    throw new ThreadAutomationRunDataError('Thread adapter-run repository contains duplicate run IDs.');
  if (new Set(runs.map((run) => run.correlationId)).size !== runs.length)
    throw new ThreadAutomationRunDataError('Thread adapter-run repository contains duplicate correlation IDs.');
  return { schemaVersion: SCHEMA_VERSION, runs };
}

function saveInto(
  runs: ThreadAutomationRun[],
  source: ThreadAutomationRun,
  expectedUpdatedAt?: string,
): ThreadAutomationRun[] {
  const run = cloneRun(source);
  const index = runs.findIndex((item) => item.runId === run.runId);
  if (expectedUpdatedAt === undefined && index >= 0)
    throw new ThreadAutomationRunConflictError('The Thread adapter run already exists.');
  if (expectedUpdatedAt !== undefined) {
    if (index < 0) throw new ThreadAutomationRunConflictError('The Thread adapter run is missing.');
    if (runs[index].updatedAt !== expectedUpdatedAt)
      throw new ThreadAutomationRunConflictError('The Thread adapter run changed since it was loaded.');
    if (run.updatedAt <= expectedUpdatedAt)
      throw new ThreadAutomationRunConflictError('The Thread adapter-run update must advance its timestamp.');
    if (runs[index].status !== 'running')
      throw new ThreadAutomationRunConflictError('A terminal Thread adapter run cannot be changed.');
    if (
      runs[index].correlationId !== run.correlationId ||
      runs[index].fixtureId !== run.fixtureId ||
      runs[index].createdAt !== run.createdAt ||
      JSON.stringify(runs[index].adapters) !== JSON.stringify(run.adapters)
    )
      throw new ThreadAutomationRunConflictError('Thread adapter-run identity is immutable.');
  }
  const next = runs.map(cloneRun);
  if (index < 0) {
    if (next.length >= MAX_RUNS)
      throw new ThreadAutomationRunConflictError('The Thread adapter-run repository is full.');
    next.push(run);
  } else next[index] = run;
  return next;
}

export class InMemoryThreadAutomationRunRepository implements ThreadAutomationRunRepository {
  #runs: ThreadAutomationRun[];

  constructor(seed: ThreadAutomationRun[] = []) {
    this.#runs = validateEnvelope({ schemaVersion: SCHEMA_VERSION, runs: seed }).runs;
  }

  async list() { return this.#runs.map(cloneRun); }
  async get(runId: ThreadAutomationRunId) {
    const run = this.#runs.find((item) => item.runId === runId);
    return run ? cloneRun(run) : undefined;
  }
  async save(run: ThreadAutomationRun, expectedUpdatedAt?: string) {
    this.#runs = saveInto(this.#runs, run, expectedUpdatedAt);
    return cloneRun(run);
  }
}

export class FileThreadAutomationRunRepository implements ThreadAutomationRunRepository {
  readonly #path: string;
  readonly #backupPath: string;
  #queue: Promise<unknown> = Promise.resolve();

  constructor(path: string) {
    if (!path || !path.toLowerCase().endsWith('.json'))
      throw new Error('Thread adapter-run repository path must be an explicit JSON file.');
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
        const empty: RepositoryEnvelope = { schemaVersion: SCHEMA_VERSION, runs: [] };
        await writeFile(this.#path, `${JSON.stringify(empty, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
        return empty;
      }
    }
    try {
      return validateEnvelope(JSON.parse(contents));
    } catch (error) {
      if (error instanceof ThreadAutomationRunDataError) throw error;
      throw new ThreadAutomationRunDataError('Thread adapter-run repository is not valid JSON.');
    }
  }

  async #readBoundedFile() {
    const metadata = await stat(this.#path);
    if (metadata.size > MAX_FILE_BYTES)
      throw new ThreadAutomationRunDataError('Thread adapter-run repository exceeds its size limit.');
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

  async list() { return this.#serialized(async () => (await this.#read()).runs.map(cloneRun)); }
  async get(runId: ThreadAutomationRunId) {
    return this.#serialized(async () => {
      const run = (await this.#read()).runs.find((item) => item.runId === runId);
      return run ? cloneRun(run) : undefined;
    });
  }
  async save(run: ThreadAutomationRun, expectedUpdatedAt?: string) {
    return this.#serialized(async () => {
      const envelope = await this.#read();
      const runs = saveInto(envelope.runs, run, expectedUpdatedAt);
      await this.#write({ schemaVersion: SCHEMA_VERSION, runs });
      return cloneRun(run);
    });
  }
}
