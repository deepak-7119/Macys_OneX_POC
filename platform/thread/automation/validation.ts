import type {
  NewThreadAutomationRun,
  ThreadAutomationFixtureId,
  ThreadAutomationRun,
} from './contracts.ts';

const runIdPattern = /^thread\.adapter-run\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const correlationIdPattern = /^thread\.correlation\.[a-z0-9][a-z0-9-]{0,80}$/;
const requestIdPattern = /^thread\.request\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const jobIdPattern = /^thread\.build-job\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const artifactIdPattern = /^thread\.artifact\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const adapterIdPattern = /^[a-z][a-z0-9-]{0,60}@(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;
const fixtures = new Set<ThreadAutomationFixtureId>([
  'inventory-button',
  'figma-promotion-banner',
]);
const decisions = new Set(['reuse', 'review-alternatives', 'inventory-gap']);

function fail(message: string): never {
  throw new Error(`Invalid Thread automation run: ${message}`);
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], label: string) {
  const extras = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extras.length) fail(`${label} contains unsupported fields: ${extras.join(', ')}`);
}

function timestamp(value: unknown, label: string): string {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
    Number.isNaN(new Date(value).getTime()) ||
    new Date(value).toISOString() !== value
  )
    fail(`${label} is malformed`);
  return value;
}

export function validateNewThreadAutomationRun(value: unknown): NewThreadAutomationRun {
  if (!record(value)) fail('input must be an object');
  exactKeys(value, ['runId', 'fixtureId'], 'input');
  if (typeof value.runId !== 'string' || !runIdPattern.test(value.runId))
    fail('runId is malformed');
  if (!fixtures.has(value.fixtureId as ThreadAutomationFixtureId))
    fail('fixtureId is not allow-listed');
  return structuredClone(value) as unknown as NewThreadAutomationRun;
}

export function validateThreadAutomationRun(value: unknown): ThreadAutomationRun {
  if (!record(value)) fail('expected an object');
  exactKeys(
    value,
    [
      'runId',
      'correlationId',
      'fixtureId',
      'sourceProvider',
      'status',
      'initiatedBy',
      'adapters',
      'discoveryDecision',
      'outcome',
      'requestId',
      'jobId',
      'artifactId',
      'failure',
      'createdAt',
      'updatedAt',
      'completedAt',
    ],
    'run',
  );
  if (typeof value.runId !== 'string' || !runIdPattern.test(value.runId)) fail('runId is malformed');
  if (typeof value.correlationId !== 'string' || !correlationIdPattern.test(value.correlationId))
    fail('correlationId is malformed');
  if (!fixtures.has(value.fixtureId as ThreadAutomationFixtureId)) fail('fixtureId is malformed');
  if (value.sourceProvider !== 'mock-figma') fail('sourceProvider is unsupported');
  if (!['running', 'completed', 'failed'].includes(value.status as string))
    fail('status is malformed');
  if (!['agent', 'engineer'].includes(value.initiatedBy as string))
    fail('initiatedBy is malformed');
  if (!record(value.adapters)) fail('adapters are missing');
  exactKeys(value.adapters, ['designSource', 'componentBuilder', 'artifactInspector'], 'adapters');
  for (const key of ['designSource', 'componentBuilder', 'artifactInspector'] as const) {
    if (typeof value.adapters[key] !== 'string' || !adapterIdPattern.test(value.adapters[key]))
      fail(`adapters.${key} is malformed`);
  }
  if (value.discoveryDecision !== undefined && !decisions.has(value.discoveryDecision as string))
    fail('discoveryDecision is malformed');
  if (value.requestId !== undefined && (typeof value.requestId !== 'string' || !requestIdPattern.test(value.requestId)))
    fail('requestId is malformed');
  if (value.jobId !== undefined && (typeof value.jobId !== 'string' || !jobIdPattern.test(value.jobId)))
    fail('jobId is malformed');
  if (value.artifactId !== undefined && (typeof value.artifactId !== 'string' || !artifactIdPattern.test(value.artifactId)))
    fail('artifactId is malformed');
  const createdAt = timestamp(value.createdAt, 'createdAt');
  const updatedAt = timestamp(value.updatedAt, 'updatedAt');
  if (updatedAt < createdAt) fail('updatedAt precedes createdAt');

  if (value.status === 'running') {
    if (value.outcome !== undefined || value.failure !== undefined || value.completedAt !== undefined)
      fail('running run contains terminal data');
  } else {
    const completedAt = timestamp(value.completedAt, 'completedAt');
    if (completedAt < createdAt || completedAt > updatedAt)
      fail('completedAt is outside the run timeline');
    if (value.status === 'completed') {
      if (value.failure !== undefined || !decisions.has(value.discoveryDecision as string))
        fail('completed run has inconsistent result data');
      if (!['inventory-resolved', 'artifact-staged'].includes(value.outcome as string))
        fail('completed run outcome is malformed');
      if (value.outcome === 'inventory-resolved') {
        if (value.requestId !== undefined || value.jobId !== undefined || value.artifactId !== undefined)
          fail('inventory-resolved run cannot contain generated records');
        if (value.discoveryDecision === 'inventory-gap')
          fail('inventory-resolved run cannot report an inventory gap');
      } else if (!value.requestId || !value.jobId || !value.artifactId || value.discoveryDecision !== 'inventory-gap') {
        fail('artifact-staged run is missing its record chain');
      }
    } else {
      if (value.outcome !== undefined || !record(value.failure))
        fail('failed run has inconsistent result data');
      exactKeys(value.failure, ['code', 'message'], 'failure');
      if (value.failure.code !== 'adapter-failed') fail('failure.code is malformed');
      if (
        typeof value.failure.message !== 'string' ||
        !value.failure.message ||
        value.failure.message.length > 300 ||
        /[\u0000-\u001f\u007f]/.test(value.failure.message)
      )
        fail('failure.message is malformed');
    }
  }
  return structuredClone(value) as unknown as ThreadAutomationRun;
}
