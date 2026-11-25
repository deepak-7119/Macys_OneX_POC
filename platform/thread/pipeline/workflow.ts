import type {
  ThreadActorRole,
  ThreadInventoryComponent,
  ThreadQualityGates,
} from '../inventory/contracts.ts';
import { assertThreadLifecycleTransition } from '../inventory/lifecycle.ts';
import { getThreadInventoryComponent } from '../inventory/registry.ts';
import { validateThreadInventoryComponent } from '../inventory/validation.ts';
import type {
  ApprovedThreadCandidate,
  NewThreadCandidate,
  NewThreadComponentRequest,
  ThreadComponentRequest,
  ThreadEvidenceResult,
  ThreadQualityGate,
  ThreadRequestSource,
} from './contracts.ts';

const requestIdPattern = /^thread\.request\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const objectIdPattern = /^thread\.component\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const exportPattern = /^[A-Z][A-Za-z0-9]{0,79}$/;
const labelPattern = /^[a-z0-9][a-z0-9:_-]{0,79}$/;
const appIdPattern = /^[a-z][a-z0-9-]{0,79}$/;
const figmaIdPattern = /^[A-Za-z0-9:_-]{1,128}$/;
const artifactIdPattern = /^[a-z0-9][a-z0-9._:-]{0,159}$/;
const safeSourcePattern = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]{1,240}$/;
const actorRoles = new Set<ThreadActorRole>(['agent', 'designer', 'engineer', 'governance']);
const categories = new Set([
  'primitive',
  'form',
  'data-display',
  'navigation',
  'feedback',
  'layout',
  'domain',
]);
const requestStatuses = new Set(['requested', 'candidate', 'review', 'approved']);
const qualityGates: readonly ThreadQualityGate[] = [
  'tests',
  'accessibility',
  'designReview',
  'securityReview',
];
const evidenceRoles: Record<ThreadQualityGate, readonly ThreadActorRole[]> = {
  tests: ['agent', 'engineer'],
  accessibility: ['designer', 'engineer', 'governance'],
  designReview: ['designer', 'governance'],
  securityReview: ['engineer', 'governance'],
};

const pendingQuality: ThreadQualityGates = {
  tests: 'pending',
  accessibility: 'pending',
  designReview: 'pending',
  securityReview: 'pending',
};

function fail(message: string): never {
  throw new Error(`Invalid Thread component request: ${message}`);
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], label: string) {
  const extras = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extras.length) fail(`${label} contains unsupported fields: ${extras.join(', ')}`);
}

function boundedString(value: unknown, label: string, maximum: number): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value !== value.trim() ||
    value.length > maximum ||
    /[\u0000-\u001f\u007f]/.test(value)
  )
    fail(`${label} is malformed`);
  return value;
}

function timestamp(value: unknown, label: string): string {
  const text = boundedString(value, label, 40);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(text))
    fail(`${label} must be a UTC ISO timestamp`);
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== text)
    fail(`${label} must be a real UTC timestamp`);
  return text;
}

function assertNextTimestamp(at: string, previous: string): void {
  const next = timestamp(at, 'transition timestamp');
  if (next < previous) fail('transition timestamp precedes the current request state');
}

function validateSource(value: unknown): ThreadRequestSource {
  if (!record(value)) fail('source is missing');
  if (value.kind === 'figma') {
    exactKeys(value, ['kind', 'fileKey', 'componentKey', 'nodeId'], 'source');
    for (const key of ['fileKey', 'componentKey', 'nodeId'] as const) {
      if (typeof value[key] !== 'string' || !figmaIdPattern.test(value[key]))
        fail(`source.${key} is malformed`);
    }
    return structuredClone(value) as ThreadRequestSource;
  }
  if (value.kind === 'application') {
    exactKeys(value, ['kind', 'appId', 'sourcePath'], 'source');
    if (typeof value.appId !== 'string' || !appIdPattern.test(value.appId))
      fail('source.appId is malformed');
    if (typeof value.sourcePath !== 'string' || !safeSourcePattern.test(value.sourcePath))
      fail('source.sourcePath is unsafe');
    return structuredClone(value) as ThreadRequestSource;
  }
  return fail('source kind is unsupported');
}

function candidateAsComponent(request: ThreadComponentRequest): ThreadInventoryComponent {
  if (!request.candidate) fail('candidate artifact is missing');
  return {
    objectId: request.objectId,
    name: request.name,
    description: request.description,
    category: request.category,
    owner: structuredClone(request.owner),
    currentVersion: request.status === 'approved' ? request.candidate.version.version : undefined,
    versions: [structuredClone(request.candidate.version)],
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
  };
}

export function validateThreadComponentRequest(value: unknown): ThreadComponentRequest {
  if (!record(value)) fail('expected an object');
  exactKeys(
    value,
    [
      'requestId',
      'objectId',
      'name',
      'description',
      'category',
      'owner',
      'source',
      'status',
      'candidate',
      'requestedBy',
      'createdAt',
      'updatedAt',
      'approvedAt',
    ],
    'request',
  );
  if (typeof value.requestId !== 'string' || !requestIdPattern.test(value.requestId))
    fail('requestId is malformed');
  if (typeof value.objectId !== 'string' || !objectIdPattern.test(value.objectId))
    fail('objectId is malformed');
  const name = boundedString(value.name, 'name', 80);
  if (!exportPattern.test(name)) fail('name must be a component export name');
  boundedString(value.description, 'description', 500);
  if (!categories.has(value.category as string)) fail('category is malformed');
  if (!record(value.owner)) fail('owner is missing');
  exactKeys(value.owner, ['team', 'issueLabel'], 'owner');
  boundedString(value.owner.team, 'owner.team', 100);
  if (typeof value.owner.issueLabel !== 'string' || !labelPattern.test(value.owner.issueLabel))
    fail('owner.issueLabel is malformed');
  validateSource(value.source);
  if (!requestStatuses.has(value.status as string)) fail('status is malformed');
  if (!actorRoles.has(value.requestedBy as ThreadActorRole)) fail('requestedBy is malformed');
  const createdAt = timestamp(value.createdAt, 'createdAt');
  const updatedAt = timestamp(value.updatedAt, 'updatedAt');
  if (updatedAt < createdAt) fail('updatedAt precedes createdAt');
  if (value.status === 'requested') {
    if (value.candidate !== undefined) fail('requested item cannot contain a candidate');
  } else {
    if (!record(value.candidate)) fail('candidate artifact is missing');
    exactKeys(value.candidate, ['version', 'evidence'], 'candidate');
    if (!record(value.candidate.evidence)) fail('candidate evidence is malformed');
    exactKeys(value.candidate.evidence, qualityGates, 'candidate evidence');
    for (const gate of qualityGates) {
      const evidence = value.candidate.evidence[gate];
      if (evidence === undefined) continue;
      if (!record(evidence)) fail(`candidate evidence.${gate} is malformed`);
      exactKeys(evidence, ['artifactId', 'recordedBy', 'recordedAt'], `candidate evidence.${gate}`);
      if (typeof evidence.artifactId !== 'string' || !artifactIdPattern.test(evidence.artifactId))
        fail(`candidate evidence.${gate}.artifactId is malformed`);
      if (!actorRoles.has(evidence.recordedBy as ThreadActorRole))
        fail(`candidate evidence.${gate}.recordedBy is malformed`);
      if (!evidenceRoles[gate].includes(evidence.recordedBy as ThreadActorRole))
        fail(`candidate evidence.${gate}.recordedBy is not authorized`);
      timestamp(evidence.recordedAt, `candidate evidence.${gate}.recordedAt`);
    }
    const request = value as unknown as ThreadComponentRequest;
    if (request.candidate!.version.status !== request.status)
      fail('candidate lifecycle does not match request status');
    const validatedComponent = validateThreadInventoryComponent(candidateAsComponent(request));
    const quality = validatedComponent.versions[0].quality;
    for (const gate of qualityGates) {
      const evidence = request.candidate!.evidence[gate];
      if (quality[gate] === 'pending' && evidence) fail(`${gate} evidence cannot remain pending`);
      if (quality[gate] !== 'pending' && !evidence) fail(`${gate} result requires evidence`);
    }
  }
  if (value.status === 'approved') {
    const approvedAt = timestamp(value.approvedAt, 'approvedAt');
    if (approvedAt < createdAt || approvedAt > updatedAt)
      fail('approvedAt is outside the request timeline');
    const request = value as unknown as ThreadComponentRequest;
    if (request.candidate?.version.approvedAt !== approvedAt)
      fail('request and candidate approval timestamps do not match');
  } else if (value.approvedAt !== undefined) {
    fail('unapproved request cannot have approvedAt');
  }
  return structuredClone(value) as unknown as ThreadComponentRequest;
}

export function validateNewThreadComponentRequest(value: unknown): NewThreadComponentRequest {
  if (!record(value)) fail('request input must be an object');
  exactKeys(
    value,
    ['requestId', 'objectId', 'name', 'description', 'category', 'owner', 'source'],
    'request input',
  );
  const at = '2000-01-01T00:00:00.000Z';
  const validated = validateThreadComponentRequest({
    ...value,
    status: 'requested',
    requestedBy: 'agent',
    createdAt: at,
    updatedAt: at,
  });
  return {
    requestId: validated.requestId,
    objectId: validated.objectId,
    name: validated.name,
    description: validated.description,
    category: validated.category,
    owner: structuredClone(validated.owner),
    source: structuredClone(validated.source),
  };
}

export function createThreadComponentRequest(
  input: NewThreadComponentRequest,
  actor: ThreadActorRole,
  at: string,
): ThreadComponentRequest {
  const validatedInput = validateNewThreadComponentRequest(input);
  if (getThreadInventoryComponent(validatedInput.objectId))
    fail('requested objectId already exists in the Thread inventory');
  const request = {
    ...validatedInput,
    status: 'requested',
    requestedBy: actor,
    createdAt: at,
    updatedAt: at,
  } satisfies ThreadComponentRequest;
  return validateThreadComponentRequest(request);
}

export function attachThreadCandidate(
  source: ThreadComponentRequest,
  input: NewThreadCandidate,
  actor: ThreadActorRole,
  at: string,
): ThreadComponentRequest {
  const request = validateThreadComponentRequest(source);
  assertNextTimestamp(at, request.updatedAt);
  assertThreadLifecycleTransition('requested', 'candidate', actor, pendingQuality);
  if (!record(input)) fail('candidate input is malformed');
  exactKeys(
    input as unknown as Record<string, unknown>,
    ['version', 'code', 'figma'],
    'candidate input',
  );
  if (request.source.kind === 'figma') {
    if (
      input.figma.status === 'unmapped' ||
      input.figma.fileKey !== request.source.fileKey ||
      input.figma.componentKey !== request.source.componentKey ||
      input.figma.nodeId !== request.source.nodeId
    )
      fail('candidate Figma binding does not match the request source');
  }
  request.status = 'candidate';
  request.updatedAt = at;
  request.candidate = {
    version: {
      version: input.version,
      status: 'candidate',
      code: structuredClone(input.code),
      figma: structuredClone(input.figma),
      quality: { ...pendingQuality },
      createdAt: at,
      updatedAt: at,
    },
    evidence: {},
  };
  return validateThreadComponentRequest(request);
}

export function recordThreadCandidateEvidence(
  source: ThreadComponentRequest,
  gate: ThreadQualityGate,
  result: ThreadEvidenceResult,
  artifactId: string,
  actor: ThreadActorRole,
  at: string,
): ThreadComponentRequest {
  const request = validateThreadComponentRequest(source);
  assertNextTimestamp(at, request.updatedAt);
  if (!request.candidate || (request.status !== 'candidate' && request.status !== 'review'))
    fail('evidence can only be recorded for a candidate or reviewed item');
  if (!qualityGates.includes(gate)) fail('evidence gate is unsupported');
  if (!evidenceRoles[gate].includes(actor))
    throw new Error(`Thread ${gate} evidence cannot be recorded by ${actor}.`);
  if (!artifactIdPattern.test(artifactId)) fail('evidence artifactId is malformed');
  request.candidate.version.quality[gate] = result;
  request.candidate.version.updatedAt = at;
  request.candidate.evidence[gate] = { artifactId, recordedBy: actor, recordedAt: at };
  request.updatedAt = at;
  return validateThreadComponentRequest(request);
}

export function submitThreadCandidateForReview(
  source: ThreadComponentRequest,
  actor: ThreadActorRole,
  at: string,
): ThreadComponentRequest {
  const request = validateThreadComponentRequest(source);
  assertNextTimestamp(at, request.updatedAt);
  if (!request.candidate || request.status !== 'candidate')
    fail('only a candidate can be submitted for review');
  if (request.candidate.version.quality.tests !== 'passed' || !request.candidate.evidence.tests)
    fail('candidate review requires passed test evidence');
  assertThreadLifecycleTransition('candidate', 'review', actor, request.candidate.version.quality);
  request.status = 'review';
  request.updatedAt = at;
  request.candidate.version.status = 'review';
  request.candidate.version.updatedAt = at;
  return validateThreadComponentRequest(request);
}

export function returnThreadCandidateToWork(
  source: ThreadComponentRequest,
  actor: ThreadActorRole,
  at: string,
): ThreadComponentRequest {
  const request = validateThreadComponentRequest(source);
  assertNextTimestamp(at, request.updatedAt);
  if (!request.candidate || request.status !== 'review')
    fail('only a reviewed candidate can return to candidate work');
  assertThreadLifecycleTransition('review', 'candidate', actor, request.candidate.version.quality);
  request.status = 'candidate';
  request.updatedAt = at;
  request.candidate.version.status = 'candidate';
  request.candidate.version.updatedAt = at;
  return validateThreadComponentRequest(request);
}

export function approveThreadCandidate(
  source: ThreadComponentRequest,
  actor: ThreadActorRole,
  at: string,
): ApprovedThreadCandidate {
  const request = validateThreadComponentRequest(source);
  assertNextTimestamp(at, request.updatedAt);
  if (!request.candidate || request.status !== 'review')
    fail('only a reviewed candidate can be approved');
  for (const gate of qualityGates) {
    if (request.candidate.version.quality[gate] !== 'passed' || !request.candidate.evidence[gate])
      fail('approval requires passed evidence for every quality gate');
  }
  if (getThreadInventoryComponent(request.objectId))
    fail('approved objectId already exists in the Thread inventory');
  assertThreadLifecycleTransition('review', 'approved', actor, request.candidate.version.quality);
  request.status = 'approved';
  request.approvedAt = at;
  request.updatedAt = at;
  request.candidate.version.status = 'approved';
  request.candidate.version.approvedAt = at;
  request.candidate.version.updatedAt = at;
  const validatedRequest = validateThreadComponentRequest(request);
  return {
    request: validatedRequest,
    component: validateThreadInventoryComponent(candidateAsComponent(validatedRequest)),
  };
}
