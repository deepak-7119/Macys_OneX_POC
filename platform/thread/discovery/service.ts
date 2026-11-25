import type { ThreadInventoryComponent } from '../inventory/contracts.ts';
import { listThreadInventory } from '../inventory/registry.ts';
import { validateThreadInventoryComponent } from '../inventory/validation.ts';
import type {
  NewThreadComponentRequest,
  ThreadComponentRequest,
  ThreadRequestSource,
} from '../pipeline/contracts.ts';
import { validateNewThreadComponentRequest } from '../pipeline/workflow.ts';
import type {
  ThreadDiscoveryMatch,
  ThreadDiscoveryResult,
  ThreadDiscoverySignal,
} from './contracts.ts';

const MATCH_THRESHOLD = 30;
const MAX_ALTERNATIVES = 5;
const ignoredWords = new Set(['and', 'for', 'from', 'into', 'that', 'the', 'this', 'with']);

function words(value: string): Set<string> {
  return new Set(
    value
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length >= 3 && !ignoredWords.has(word)),
  );
}

function overlap(left: Set<string>, right: Set<string>): number {
  if (!left.size || !right.size) return 0;
  let matches = 0;
  for (const word of left) if (right.has(word)) matches += 1;
  return matches / Math.max(left.size, right.size);
}

function representativeVersion(component: ThreadInventoryComponent) {
  const current = component.currentVersion
    ? component.versions.find((version) => version.version === component.currentVersion)
    : undefined;
  return (
    current ??
    [...component.versions].sort(
      (left, right) =>
        right.updatedAt.localeCompare(left.updatedAt) || right.version.localeCompare(left.version),
    )[0]
  );
}

function matchComponent(
  requirement: NewThreadComponentRequest,
  component: ThreadInventoryComponent,
): { match: ThreadDiscoveryMatch; exact: boolean } {
  const signals: ThreadDiscoverySignal[] = [];
  const exactObjectId = component.objectId === requirement.objectId;
  const exactName = component.name === requirement.name;
  if (exactObjectId) signals.push('object-id');
  if (exactName) signals.push('export-name');

  let score = exactObjectId ? 100 : exactName ? 95 : 0;
  if (!exactObjectId && !exactName) {
    const nameOverlap = overlap(words(requirement.name), words(component.name));
    const descriptionOverlap = overlap(
      words(requirement.description),
      words(component.description),
    );
    if (nameOverlap > 0) {
      signals.push('name-token');
      score += Math.round(nameOverlap * 60);
    }
    if (descriptionOverlap > 0) {
      signals.push('description-token');
      score += Math.round(descriptionOverlap * 30);
    }
    if (component.category === requirement.category) {
      signals.push('category');
      score += 10;
    }
  } else if (component.category === requirement.category) {
    signals.push('category');
  }

  const version = representativeVersion(component);
  const available = component.currentVersion === version.version && version.status === 'approved';
  return {
    exact: exactObjectId || exactName,
    match: {
      reference: { objectId: component.objectId, version: version.version },
      name: component.name,
      category: component.category,
      status: version.status,
      adoptionState: available ? 'available' : 'blocked',
      score,
      signals,
    },
  };
}

export function discoverThreadComponents(
  input: NewThreadComponentRequest,
  catalog: readonly ThreadInventoryComponent[] = listThreadInventory(),
): ThreadDiscoveryResult {
  const requirement = validateNewThreadComponentRequest(input);
  const matches = catalog
    .map((component) => validateThreadInventoryComponent(component))
    .map((component) => matchComponent(requirement, component))
    .sort(
      (left, right) =>
        Number(right.exact) - Number(left.exact) ||
        right.match.score - left.match.score ||
        left.match.reference.objectId.localeCompare(right.match.reference.objectId),
    );
  const exact = matches.find((candidate) => candidate.exact)?.match;
  const alternatives = matches
    .filter((candidate) => !candidate.exact && candidate.match.score >= MATCH_THRESHOLD)
    .slice(0, MAX_ALTERNATIVES)
    .map((candidate) => candidate.match);

  if (exact?.adoptionState === 'available') {
    return {
      requirement,
      decision: 'reuse',
      explanation: 'An exact approved inventory version is available for reuse.',
      canOpenRequest: false,
      exactMatch: exact,
      alternatives,
    };
  }
  if (exact) {
    return {
      requirement,
      decision: 'review-alternatives',
      explanation:
        'An exact inventory component exists, but its selected version is not approved for new adoption.',
      canOpenRequest: false,
      exactMatch: exact,
      alternatives,
    };
  }
  if (alternatives.length) {
    return {
      requirement,
      decision: 'review-alternatives',
      explanation:
        'Related inventory components require human review before a new component request is opened.',
      canOpenRequest: false,
      alternatives,
    };
  }
  return {
    requirement,
    decision: 'inventory-gap',
    explanation: 'No exact or sufficiently related Thread component was found.',
    canOpenRequest: true,
    alternatives: [],
  };
}

function sameSource(left: ThreadRequestSource, right: ThreadRequestSource): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === 'figma' && right.kind === 'figma')
    return (
      left.fileKey === right.fileKey &&
      left.componentKey === right.componentKey &&
      left.nodeId === right.nodeId
    );
  if (left.kind === 'application' && right.kind === 'application')
    return left.appId === right.appId && left.sourcePath === right.sourcePath;
  return false;
}

export function findDuplicateThreadRequest(
  input: NewThreadComponentRequest,
  requests: readonly ThreadComponentRequest[],
): ThreadComponentRequest | undefined {
  const requirement = validateNewThreadComponentRequest(input);
  const duplicate = requests.find(
    (request) =>
      request.objectId === requirement.objectId ||
      (request.name === requirement.name &&
        request.category === requirement.category &&
        sameSource(request.source, requirement.source)),
  );
  return duplicate ? structuredClone(duplicate) : undefined;
}
