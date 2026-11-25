import {
  threadLifecycleStatuses,
  type ThreadComponentCategory,
  type ThreadComponentReference,
  type ThreadComponentVersion,
  type ThreadFigmaBinding,
  type ThreadInventoryComponent,
  type ThreadLifecycleStatus,
  type ThreadQualityGates,
} from './contracts.ts';

const categories = new Set<ThreadComponentCategory>([
  'primitive',
  'form',
  'data-display',
  'navigation',
  'feedback',
  'layout',
  'domain',
]);
const lifecycle = new Set<string>(threadLifecycleStatuses);
const qualityResults = new Set(['pending', 'passed', 'failed']);
const figmaStatuses = new Set(['unmapped', 'mapped', 'verified']);
const objectIdPattern = /^thread\.component\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const semverPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const packagePattern = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const exportPattern = /^[A-Z][A-Za-z0-9]{0,79}$/;
const safeLabelPattern = /^[a-z0-9][a-z0-9:_-]{0,79}$/;
const safeFigmaIdPattern = /^[A-Za-z0-9:_-]{1,128}$/;
const safeSourcePattern = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]{1,240}$/;

function fail(message: string): never {
  throw new Error(`Invalid Thread inventory component: ${message}`);
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

function validateQuality(value: unknown): ThreadQualityGates {
  if (!record(value)) fail('quality gates are missing');
  exactKeys(value, ['tests', 'accessibility', 'designReview', 'securityReview'], 'quality');
  for (const key of ['tests', 'accessibility', 'designReview', 'securityReview'] as const) {
    if (!qualityResults.has(value[key] as string)) fail(`quality.${key} is malformed`);
  }
  return value as unknown as ThreadQualityGates;
}

export function qualityGatesPassed(quality: ThreadQualityGates): boolean {
  return Object.values(quality).every((result) => result === 'passed');
}

function validateFigma(value: unknown): ThreadFigmaBinding {
  if (!record(value)) fail('Figma binding is missing');
  exactKeys(value, ['status', 'fileKey', 'componentKey', 'nodeId'], 'figma');
  if (!figmaStatuses.has(value.status as string)) fail('figma.status is malformed');
  for (const key of ['fileKey', 'componentKey', 'nodeId'] as const) {
    if (value[key] !== undefined && !safeFigmaIdPattern.test(value[key] as string))
      fail(`figma.${key} is malformed`);
  }
  const identifiers = ['fileKey', 'componentKey', 'nodeId'].filter(
    (key) => value[key] !== undefined,
  );
  if (value.status === 'unmapped' && identifiers.length) fail('unmapped Figma binding has IDs');
  if (value.status !== 'unmapped' && identifiers.length !== 3)
    fail('mapped Figma binding requires all IDs');
  return value as unknown as ThreadFigmaBinding;
}

function validateVersion(value: unknown): ThreadComponentVersion {
  if (!record(value)) fail('version is malformed');
  exactKeys(
    value,
    ['version', 'status', 'code', 'figma', 'quality', 'createdAt', 'updatedAt', 'approvedAt'],
    'version',
  );
  const version = boundedString(value.version, 'version', 80);
  if (!semverPattern.test(version)) fail('version must use semantic versioning');
  if (!lifecycle.has(value.status as string)) fail('version status is malformed');
  if (!record(value.code)) fail('code binding is missing');
  exactKeys(value.code, ['framework', 'packageName', 'exportName', 'sourcePath'], 'code');
  if (value.code.framework !== 'react') fail('code framework is unsupported');
  if (!packagePattern.test(value.code.packageName as string)) fail('code package is malformed');
  if (!exportPattern.test(value.code.exportName as string)) fail('code export is malformed');
  if (!safeSourcePattern.test(value.code.sourcePath as string)) fail('code source path is unsafe');
  validateFigma(value.figma);
  const quality = validateQuality(value.quality);
  const createdAt = timestamp(value.createdAt, 'version.createdAt');
  const updatedAt = timestamp(value.updatedAt, 'version.updatedAt');
  if (updatedAt < createdAt) fail('version.updatedAt precedes createdAt');
  const approved = ['approved', 'deprecated', 'retired'].includes(value.status as string);
  if (approved) {
    if (!qualityGatesPassed(quality)) fail('released version has incomplete quality gates');
    const approvedAt = timestamp(value.approvedAt, 'version.approvedAt');
    if (approvedAt < createdAt || approvedAt > updatedAt)
      fail('version.approvedAt is outside the version timeline');
  } else if (value.approvedAt !== undefined) {
    fail('unapproved version cannot have approvedAt');
  }
  return value as unknown as ThreadComponentVersion;
}

export function validateThreadInventoryComponent(value: unknown): ThreadInventoryComponent {
  if (!record(value)) fail('expected an object');
  exactKeys(
    value,
    [
      'objectId',
      'name',
      'description',
      'category',
      'owner',
      'currentVersion',
      'versions',
      'createdAt',
      'updatedAt',
    ],
    'component',
  );
  if (typeof value.objectId !== 'string' || !objectIdPattern.test(value.objectId))
    fail('objectId is malformed');
  const name = boundedString(value.name, 'name', 80);
  if (!exportPattern.test(name)) fail('name must be a component export name');
  boundedString(value.description, 'description', 500);
  if (!categories.has(value.category as ThreadComponentCategory)) fail('category is malformed');
  if (!record(value.owner)) fail('owner is missing');
  exactKeys(value.owner, ['team', 'issueLabel'], 'owner');
  boundedString(value.owner.team, 'owner.team', 100);
  if (!safeLabelPattern.test(value.owner.issueLabel as string))
    fail('owner.issueLabel is malformed');
  if (!Array.isArray(value.versions) || !value.versions.length) fail('versions are missing');
  const versions = value.versions.map(validateVersion);
  const versionNumbers = versions.map((item) => item.version);
  if (new Set(versionNumbers).size !== versionNumbers.length)
    fail('version numbers are duplicated');
  if (value.currentVersion !== undefined) {
    if (typeof value.currentVersion !== 'string' || !semverPattern.test(value.currentVersion))
      fail('currentVersion is malformed');
    const current = versions.find((item) => item.version === value.currentVersion);
    if (!current || !['approved', 'deprecated'].includes(current.status))
      fail('currentVersion must identify a released version');
  }
  const createdAt = timestamp(value.createdAt, 'createdAt');
  const updatedAt = timestamp(value.updatedAt, 'updatedAt');
  if (updatedAt < createdAt) fail('updatedAt precedes createdAt');
  if (versions.some((item) => item.createdAt < createdAt || item.updatedAt > updatedAt))
    fail('version timeline is outside the component timeline');
  return structuredClone(value) as unknown as ThreadInventoryComponent;
}

export function validateThreadComponentReference(value: unknown): ThreadComponentReference {
  if (!record(value)) fail('component reference is malformed');
  exactKeys(value, ['objectId', 'version'], 'component reference');
  if (typeof value.objectId !== 'string' || !objectIdPattern.test(value.objectId))
    fail('component reference objectId is malformed');
  if (typeof value.version !== 'string' || !semverPattern.test(value.version))
    fail('component reference version is malformed');
  return structuredClone(value) as unknown as ThreadComponentReference;
}

export function isReleasedStatus(status: ThreadLifecycleStatus): boolean {
  return status === 'approved' || status === 'deprecated' || status === 'retired';
}
