import { validateThreadInventoryComponent } from '../inventory/validation.ts';
import type { ThreadReleaseRecord } from './contracts.ts';

const releaseIdPattern = /^thread\.release\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const requestIdPattern = /^thread\.request\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const jobIdPattern = /^thread\.build-job\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const artifactIdPattern = /^thread\.artifact\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const evidenceIdPattern = /^[a-z0-9][a-z0-9._:-]{0,159}$/;
const sha256Pattern = /^[a-f0-9]{64}$/;

function fail(message: string): never {
  throw new Error(`Invalid Thread release: ${message}`);
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

export function validateThreadRelease(value: unknown): ThreadReleaseRecord {
  if (!record(value)) fail('expected an object');
  exactKeys(
    value,
    [
      'releaseId',
      'requestId',
      'jobId',
      'artifactId',
      'status',
      'component',
      'artifactContent',
      'promotedBy',
      'createdAt',
      'updatedAt',
      'rollback',
    ],
    'release',
  );
  if (typeof value.releaseId !== 'string' || !releaseIdPattern.test(value.releaseId))
    fail('releaseId is malformed');
  if (typeof value.requestId !== 'string' || !requestIdPattern.test(value.requestId))
    fail('requestId is malformed');
  if (typeof value.jobId !== 'string' || !jobIdPattern.test(value.jobId))
    fail('jobId is malformed');
  if (typeof value.artifactId !== 'string' || !artifactIdPattern.test(value.artifactId))
    fail('artifactId is malformed');
  if (!['active', 'rolled-back'].includes(value.status as string)) fail('status is malformed');
  if (value.promotedBy !== 'governance') fail('promotedBy is malformed');
  const component = validateThreadInventoryComponent(value.component);
  const current = component.versions.find((item) => item.version === component.currentVersion);
  if (!current) fail('component current version is missing');

  if (!record(value.artifactContent)) fail('artifactContent is missing');
  exactKeys(value.artifactContent, ['sha256', 'sizeBytes', 'mediaType'], 'artifactContent');
  if (
    typeof value.artifactContent.sha256 !== 'string' ||
    !sha256Pattern.test(value.artifactContent.sha256)
  )
    fail('artifactContent.sha256 is malformed');
  if (
    !Number.isSafeInteger(value.artifactContent.sizeBytes) ||
    (value.artifactContent.sizeBytes as number) < 1 ||
    (value.artifactContent.sizeBytes as number) > 10 * 1024 * 1024
  )
    fail('artifactContent.sizeBytes is outside the allowed range');
  if (value.artifactContent.mediaType !== 'application/gzip')
    fail('artifactContent.mediaType is unsupported');

  const createdAt = timestamp(value.createdAt, 'createdAt');
  const updatedAt = timestamp(value.updatedAt, 'updatedAt');
  if (updatedAt < createdAt) fail('updatedAt precedes createdAt');
  if (value.status === 'active') {
    if (current.status !== 'approved' || value.rollback !== undefined)
      fail('active release has inconsistent lifecycle data');
  } else {
    if (current.status !== 'deprecated' || !record(value.rollback))
      fail('rolled-back release has inconsistent lifecycle data');
    exactKeys(value.rollback, ['reason', 'evidenceId', 'recordedBy', 'recordedAt'], 'rollback');
    if (
      typeof value.rollback.reason !== 'string' ||
      value.rollback.reason !== value.rollback.reason.trim() ||
      value.rollback.reason.length < 10 ||
      value.rollback.reason.length > 300 ||
      /[\u0000-\u001f\u007f]/.test(value.rollback.reason)
    )
      fail('rollback.reason is malformed');
    if (
      typeof value.rollback.evidenceId !== 'string' ||
      !evidenceIdPattern.test(value.rollback.evidenceId)
    )
      fail('rollback.evidenceId is malformed');
    if (value.rollback.recordedBy !== 'governance') fail('rollback.recordedBy is malformed');
    const recordedAt = timestamp(value.rollback.recordedAt, 'rollback.recordedAt');
    if (recordedAt < createdAt || recordedAt > updatedAt)
      fail('rollback evidence is outside the release timeline');
  }
  return structuredClone(value) as unknown as ThreadReleaseRecord;
}
