import type {
  ThreadArtifactPolicyEvidence,
  ThreadArtifactPolicyGate,
  ThreadArtifactRecord,
} from './contracts.ts';

const artifactIdPattern = /^thread\.artifact\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const jobIdPattern = /^thread\.build-job\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const requestIdPattern = /^thread\.request\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const objectIdPattern = /^thread\.component\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const semverPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const packagePattern = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const exportPattern = /^[A-Z][A-Za-z0-9]{0,79}$/;
const sourcePattern = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]{1,240}$/;
const evidencePattern = /^[a-z0-9][a-z0-9._:-]{0,159}$/;
const sha256Pattern = /^[a-f0-9]{64}$/;
const statuses = new Set(['staged', 'verified', 'rejected']);
const gates: readonly ThreadArtifactPolicyGate[] = [
  'provenance',
  'dependencyAudit',
  'licenseReview',
];

function fail(message: string): never {
  throw new Error(`Invalid Thread artifact: ${message}`);
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

function policyEvidence(
  value: unknown,
  gate: ThreadArtifactPolicyGate,
): ThreadArtifactPolicyEvidence {
  if (!record(value)) fail(`policyEvidence.${gate} is malformed`);
  exactKeys(value, ['result', 'artifactId', 'recordedBy', 'recordedAt'], `policyEvidence.${gate}`);
  if (!['passed', 'failed'].includes(value.result as string))
    fail(`policyEvidence.${gate}.result is malformed`);
  if (typeof value.artifactId !== 'string' || !evidencePattern.test(value.artifactId))
    fail(`policyEvidence.${gate}.artifactId is malformed`);
  if (value.recordedBy !== 'engineer') fail(`policyEvidence.${gate}.recordedBy is malformed`);
  return {
    result: value.result as ThreadArtifactPolicyEvidence['result'],
    artifactId: value.artifactId,
    recordedBy: 'engineer',
    recordedAt: timestamp(value.recordedAt, `policyEvidence.${gate}.recordedAt`),
  };
}

export function validateThreadArtifact(value: unknown): ThreadArtifactRecord {
  if (!record(value)) fail('expected an object');
  exactKeys(
    value,
    [
      'artifactId',
      'jobId',
      'requestId',
      'objectId',
      'status',
      'package',
      'content',
      'sourceEvidence',
      'policyEvidence',
      'stagedBy',
      'createdAt',
      'updatedAt',
      'verifiedAt',
      'rejectedAt',
    ],
    'artifact',
  );
  if (typeof value.artifactId !== 'string' || !artifactIdPattern.test(value.artifactId))
    fail('artifactId is malformed');
  if (typeof value.jobId !== 'string' || !jobIdPattern.test(value.jobId))
    fail('jobId is malformed');
  if (typeof value.requestId !== 'string' || !requestIdPattern.test(value.requestId))
    fail('requestId is malformed');
  if (typeof value.objectId !== 'string' || !objectIdPattern.test(value.objectId))
    fail('objectId is malformed');
  if (!statuses.has(value.status as string)) fail('status is malformed');
  if (!['agent', 'engineer'].includes(value.stagedBy as string)) fail('stagedBy is malformed');

  if (!record(value.package)) fail('package is missing');
  exactKeys(value.package, ['version', 'code'], 'package');
  if (typeof value.package.version !== 'string' || !semverPattern.test(value.package.version))
    fail('package.version is malformed');
  if (!record(value.package.code)) fail('package.code is missing');
  exactKeys(
    value.package.code,
    ['framework', 'packageName', 'exportName', 'sourcePath'],
    'package.code',
  );
  if (
    value.package.code.framework !== 'react' ||
    typeof value.package.code.packageName !== 'string' ||
    !packagePattern.test(value.package.code.packageName) ||
    typeof value.package.code.exportName !== 'string' ||
    !exportPattern.test(value.package.code.exportName) ||
    typeof value.package.code.sourcePath !== 'string' ||
    !sourcePattern.test(value.package.code.sourcePath)
  )
    fail('package.code is malformed');

  if (!record(value.content)) fail('content is missing');
  exactKeys(value.content, ['sha256', 'sizeBytes', 'mediaType'], 'content');
  if (typeof value.content.sha256 !== 'string' || !sha256Pattern.test(value.content.sha256))
    fail('content.sha256 is malformed');
  if (
    !Number.isSafeInteger(value.content.sizeBytes) ||
    (value.content.sizeBytes as number) < 1 ||
    (value.content.sizeBytes as number) > 10 * 1024 * 1024
  )
    fail('content.sizeBytes is outside the allowed range');
  if (value.content.mediaType !== 'application/gzip') fail('content.mediaType is unsupported');

  if (!record(value.sourceEvidence)) fail('sourceEvidence is missing');
  exactKeys(value.sourceEvidence, ['buildLogArtifactId', 'sbomArtifactId'], 'sourceEvidence');
  for (const key of ['buildLogArtifactId', 'sbomArtifactId'] as const) {
    if (
      typeof value.sourceEvidence[key] !== 'string' ||
      !evidencePattern.test(value.sourceEvidence[key])
    )
      fail(`sourceEvidence.${key} is malformed`);
  }

  if (!record(value.policyEvidence)) fail('policyEvidence is malformed');
  exactKeys(value.policyEvidence, gates, 'policyEvidence');
  const validatedPolicy: Partial<Record<ThreadArtifactPolicyGate, ThreadArtifactPolicyEvidence>> =
    {};
  for (const gate of gates) {
    if (value.policyEvidence[gate] !== undefined)
      validatedPolicy[gate] = policyEvidence(value.policyEvidence[gate], gate);
  }
  const createdAt = timestamp(value.createdAt, 'createdAt');
  const updatedAt = timestamp(value.updatedAt, 'updatedAt');
  if (updatedAt < createdAt) fail('updatedAt precedes createdAt');
  if (value.status === 'staged') {
    if (
      Object.keys(validatedPolicy).length ||
      value.verifiedAt !== undefined ||
      value.rejectedAt !== undefined
    )
      fail('staged artifact contains verification data');
  } else {
    if (gates.some((gate) => !validatedPolicy[gate]))
      fail('terminal artifact requires every policy evidence gate');
    for (const evidence of Object.values(validatedPolicy)) {
      if (evidence.recordedAt < createdAt || evidence.recordedAt > updatedAt)
        fail('policy evidence is outside the artifact timeline');
    }
    const passed = gates.every((gate) => validatedPolicy[gate]?.result === 'passed');
    if (value.status === 'verified') {
      if (!passed || value.rejectedAt !== undefined)
        fail('verified artifact has inconsistent policy data');
      const verifiedAt = timestamp(value.verifiedAt, 'verifiedAt');
      if (verifiedAt < createdAt || verifiedAt > updatedAt)
        fail('verifiedAt is outside the artifact timeline');
    } else {
      if (passed || value.verifiedAt !== undefined)
        fail('rejected artifact has inconsistent policy data');
      const rejectedAt = timestamp(value.rejectedAt, 'rejectedAt');
      if (rejectedAt < createdAt || rejectedAt > updatedAt)
        fail('rejectedAt is outside the artifact timeline');
    }
  }
  return structuredClone(value) as unknown as ThreadArtifactRecord;
}
