import type { NewThreadCandidate, ThreadEvidenceResult } from '../pipeline/contracts.ts';
import type { ThreadBuildJob, ThreadBuildTestEvidence } from './contracts.ts';

const jobIdPattern = /^thread\.build-job\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const requestIdPattern = /^thread\.request\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const objectIdPattern = /^thread\.component\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const semverPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const packagePattern = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const exportPattern = /^[A-Z][A-Za-z0-9]{0,79}$/;
const sourcePattern = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]{1,240}$/;
const figmaIdPattern = /^[A-Za-z0-9:_-]{1,128}$/;
const artifactPattern = /^[a-z0-9][a-z0-9._:-]{0,159}$/;
const statuses = new Set(['queued', 'running', 'candidate-ready', 'attached']);
const buildActors = new Set(['agent', 'engineer']);

function fail(message: string): never {
  throw new Error(`Invalid Thread build job: ${message}`);
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], label: string) {
  const extras = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extras.length) fail(`${label} contains unsupported fields: ${extras.join(', ')}`);
}

function isoTimestamp(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value))
    fail(`${label} is malformed`);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value)
    fail(`${label} is malformed`);
  return value;
}

function validateFigma(value: unknown): NewThreadCandidate['figma'] {
  if (!record(value)) fail('candidate.figma is missing');
  exactKeys(value, ['status', 'fileKey', 'componentKey', 'nodeId'], 'candidate.figma');
  if (!['unmapped', 'mapped', 'verified'].includes(value.status as string))
    fail('candidate.figma.status is malformed');
  const ids = ['fileKey', 'componentKey', 'nodeId'] as const;
  for (const key of ids) {
    if (
      value[key] !== undefined &&
      (typeof value[key] !== 'string' || !figmaIdPattern.test(value[key] as string))
    )
      fail(`candidate.figma.${key} is malformed`);
  }
  const count = ids.filter((key) => value[key] !== undefined).length;
  if (value.status === 'unmapped' ? count !== 0 : count !== 3)
    fail('candidate.figma identifiers do not match its status');
  return structuredClone(value) as unknown as NewThreadCandidate['figma'];
}

function validateCandidate(value: unknown): NewThreadCandidate {
  if (!record(value)) fail('output candidate is missing');
  exactKeys(value, ['version', 'code', 'figma'], 'candidate');
  if (typeof value.version !== 'string' || !semverPattern.test(value.version))
    fail('candidate.version is malformed');
  if (!record(value.code)) fail('candidate.code is missing');
  exactKeys(value.code, ['framework', 'packageName', 'exportName', 'sourcePath'], 'candidate.code');
  if (
    value.code.framework !== 'react' ||
    typeof value.code.packageName !== 'string' ||
    !packagePattern.test(value.code.packageName) ||
    typeof value.code.exportName !== 'string' ||
    !exportPattern.test(value.code.exportName) ||
    typeof value.code.sourcePath !== 'string' ||
    !sourcePattern.test(value.code.sourcePath)
  )
    fail('candidate.code is malformed');
  return {
    version: value.version,
    code: structuredClone(value.code) as unknown as NewThreadCandidate['code'],
    figma: validateFigma(value.figma),
  };
}

function validateTests(value: unknown): ThreadBuildTestEvidence {
  if (!record(value)) fail('output tests are missing');
  exactKeys(value, ['result', 'artifactId'], 'output tests');
  if (!['passed', 'failed'].includes(value.result as string)) fail('test result is malformed');
  if (typeof value.artifactId !== 'string' || !artifactPattern.test(value.artifactId))
    fail('test artifactId is malformed');
  return {
    result: value.result as ThreadEvidenceResult,
    artifactId: value.artifactId,
  };
}

export function validateThreadBuildJob(value: unknown): ThreadBuildJob {
  if (!record(value)) fail('expected an object');
  exactKeys(
    value,
    [
      'jobId',
      'requestId',
      'objectId',
      'status',
      'framework',
      'requestedBy',
      'claimedBy',
      'output',
      'createdAt',
      'updatedAt',
      'submittedAt',
      'attachedAt',
    ],
    'job',
  );
  if (typeof value.jobId !== 'string' || !jobIdPattern.test(value.jobId))
    fail('jobId is malformed');
  if (typeof value.requestId !== 'string' || !requestIdPattern.test(value.requestId))
    fail('requestId is malformed');
  if (typeof value.objectId !== 'string' || !objectIdPattern.test(value.objectId))
    fail('objectId is malformed');
  if (!statuses.has(value.status as string)) fail('status is malformed');
  if (value.framework !== 'react') fail('framework is unsupported');
  if (!buildActors.has(value.requestedBy as string)) fail('requestedBy is malformed');
  if (value.claimedBy !== undefined && !buildActors.has(value.claimedBy as string))
    fail('claimedBy is malformed');
  const createdAt = isoTimestamp(value.createdAt, 'createdAt');
  const updatedAt = isoTimestamp(value.updatedAt, 'updatedAt');
  if (updatedAt < createdAt) fail('updatedAt precedes createdAt');

  if (value.status === 'queued') {
    if (value.claimedBy !== undefined || value.output !== undefined)
      fail('queued job has later-stage data');
  } else if (value.claimedBy === undefined) {
    fail('non-queued job requires claimedBy');
  }
  if (value.status === 'candidate-ready' || value.status === 'attached') {
    if (!record(value.output)) fail('candidate-ready job requires output');
    exactKeys(value.output, ['candidate', 'tests'], 'output');
    validateCandidate(value.output.candidate);
    validateTests(value.output.tests);
    const submittedAt = isoTimestamp(value.submittedAt, 'submittedAt');
    if (submittedAt < createdAt || submittedAt > updatedAt)
      fail('submittedAt is outside the job timeline');
  } else if (value.output !== undefined || value.submittedAt !== undefined) {
    fail('unfinished job cannot contain output');
  }
  if (value.status === 'attached') {
    const attachedAt = isoTimestamp(value.attachedAt, 'attachedAt');
    if (attachedAt < (value.submittedAt as string) || attachedAt > updatedAt)
      fail('attachedAt is outside the job timeline');
  } else if (value.attachedAt !== undefined) {
    fail('unattached job cannot contain attachedAt');
  }
  return structuredClone(value) as unknown as ThreadBuildJob;
}
