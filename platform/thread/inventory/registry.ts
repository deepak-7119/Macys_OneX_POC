import type {
  ThreadComponentCategory,
  ThreadComponentReference,
  ThreadComponentVersion,
  ThreadInventoryComponent,
  ThreadQualityGates,
} from './contracts.ts';
import {
  validateThreadComponentReference,
  validateThreadInventoryComponent,
} from './validation.ts';

const capturedAt = '2026-11-17T00:00:00.000Z';
const baselineQuality: ThreadQualityGates = {
  tests: 'passed',
  accessibility: 'pending',
  designReview: 'pending',
  securityReview: 'pending',
};

function baselineComponent(
  slug: string,
  name: string,
  description: string,
  category: ThreadComponentCategory,
): ThreadInventoryComponent {
  return {
    objectId: `thread.component.${slug}`,
    name,
    description,
    category,
    owner: { team: 'Thread Platform', issueLabel: `thread:${slug}` },
    versions: [
      {
        version: '1.0.0',
        status: 'review',
        code: {
          framework: 'react',
          packageName: '@macys/thread-react',
          exportName: name,
          sourcePath: 'platform/thread/src/index.tsx',
        },
        figma: { status: 'unmapped' },
        quality: { ...baselineQuality },
        createdAt: capturedAt,
        updatedAt: capturedAt,
      },
    ],
    createdAt: capturedAt,
    updatedAt: capturedAt,
  };
}

const registeredComponents = [
  baselineComponent(
    'back-button',
    'BackButton',
    'Consistent application back navigation with shared styling and button semantics.',
    'navigation',
  ),
  baselineComponent(
    'badge',
    'Badge',
    'Compact semantic label for neutral, success, warning and accent states.',
    'feedback',
  ),
  baselineComponent(
    'button',
    'Button',
    'Shared button primitive with primary, secondary and ghost variants.',
    'primitive',
  ),
  baselineComponent(
    'context-bar',
    'ContextBar',
    'Displays application context, scope and synthetic-data notices.',
    'layout',
  ),
  baselineComponent(
    'data-table',
    'DataTable',
    'Accessible tabular results with application-provided columns and row actions.',
    'data-display',
  ),
  baselineComponent(
    'feedback',
    'Feedback',
    'Loading, empty, informational and error feedback with optional retry.',
    'feedback',
  ),
  baselineComponent(
    'page-header',
    'PageHeader',
    'Page title, eyebrow, description and action layout with focus support.',
    'layout',
  ),
  baselineComponent(
    'panel',
    'Panel',
    'Shared bordered content container with optional title and flush layout.',
    'layout',
  ),
  baselineComponent(
    'query-form',
    'QueryForm',
    'Manifest-driven labelled query fields with native validation and submission.',
    'form',
  ),
  baselineComponent(
    'request-error',
    'RequestError',
    'Correlated request error presentation with code, request ID and retry.',
    'feedback',
  ),
  baselineComponent(
    'results-summary',
    'ResultsSummary',
    'Compact displayed/total result context below a result collection.',
    'data-display',
  ),
  baselineComponent(
    'tabs',
    'Tabs',
    'Keyboard-operable tab list with stable tab and panel relationships.',
    'navigation',
  ),
].map(validateThreadInventoryComponent);

const ids = registeredComponents.map((component) => component.objectId);
const names = registeredComponents.map((component) => component.name);
if (new Set(ids).size !== ids.length) throw new Error('Thread inventory has duplicate object IDs.');
if (new Set(names).size !== names.length)
  throw new Error('Thread inventory has duplicate component names.');

const byObjectId = new Map(
  registeredComponents.map((component) => [component.objectId, component]),
);
const byExportName = new Map(registeredComponents.map((component) => [component.name, component]));

export interface ThreadInventoryExclusion {
  name: string;
  sourcePath: string;
  reason: string;
}

/** App-local components currently named by manifests but deliberately not added to Thread. */
export const threadInventoryExclusions: readonly ThreadInventoryExclusion[] = Object.freeze([
  {
    name: 'DocumentViewer',
    sourcePath: 'applications/associate-communications/src/AssociateCommunicationsApp.tsx',
    reason: 'Associate Communications document journey behavior; reuse is not yet demonstrated.',
  },
  {
    name: 'Receipt',
    sourcePath: 'applications/transaction-history/src/TransactionHistoryApp.tsx',
    reason: 'Transaction-specific receipt composition; reuse is not yet demonstrated.',
  },
]);

export function listThreadInventory(): ThreadInventoryComponent[] {
  return registeredComponents.map((component) => validateThreadInventoryComponent(component));
}

export function getThreadInventoryComponent(
  objectId: string,
): ThreadInventoryComponent | undefined {
  const component = byObjectId.get(objectId as ThreadInventoryComponent['objectId']);
  return component ? validateThreadInventoryComponent(component) : undefined;
}

export function findThreadInventoryComponentByExport(
  exportName: string,
): ThreadInventoryComponent | undefined {
  const component = byExportName.get(exportName);
  return component ? validateThreadInventoryComponent(component) : undefined;
}

export interface ResolvedThreadComponentReference {
  component: ThreadInventoryComponent;
  version: ThreadComponentVersion;
}

export function resolveThreadComponentReference(
  reference: ThreadComponentReference,
): ResolvedThreadComponentReference | undefined {
  const validated = validateThreadComponentReference(reference);
  const component = getThreadInventoryComponent(validated.objectId);
  const version = component?.versions.find((item) => item.version === validated.version);
  return component && version ? { component, version: structuredClone(version) } : undefined;
}

export function threadComponentReference(
  exportName: string,
  version: string,
): ThreadComponentReference {
  const component = findThreadInventoryComponentByExport(exportName);
  if (!component) throw new Error(`Thread inventory export is not registered: ${exportName}`);
  const reference = validateThreadComponentReference({ objectId: component.objectId, version });
  if (!resolveThreadComponentReference(reference))
    throw new Error(`Thread inventory version is not registered: ${component.objectId}@${version}`);
  return reference;
}
