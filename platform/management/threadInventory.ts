import type { AppManifest } from '../contracts/index.ts';
import type {
  ThreadComponentCategory,
  ThreadFigmaBinding,
  ThreadLifecycleStatus,
  ThreadObjectId,
  ThreadQualityGates,
} from '../thread/inventory/contracts.ts';
import {
  listThreadInventory,
  resolveThreadComponentReference,
} from '../thread/inventory/registry.ts';

export interface ThreadInventoryManagementRow {
  objectId: ThreadObjectId;
  name: string;
  description: string;
  category: ThreadComponentCategory;
  version: string;
  status: ThreadLifecycleStatus;
  ownerTeam: string;
  issueLabel: string;
  packageName: string;
  exportName: string;
  figma: ThreadFigmaBinding;
  quality: ThreadQualityGates;
  appIds: string[];
  adoptionState: 'available' | 'blocked';
}

export interface ThreadInventoryManagementSummary {
  componentCount: number;
  versionCount: number;
  approvedVersionCount: number;
  reviewVersionCount: number;
  figmaMappedVersionCount: number;
}

function referenceKey(objectId: string, version: string): string {
  return `${objectId}@${version}`;
}

export function threadInventoryManagementRows(apps: AppManifest[]): ThreadInventoryManagementRow[] {
  const usage = new Map<string, Set<string>>();
  for (const app of apps) {
    for (const reference of app.componentRefs) {
      const resolved = resolveThreadComponentReference(reference);
      if (!resolved)
        throw new Error(`Unresolved Thread component: ${reference.objectId}@${reference.version}`);
      const key = referenceKey(reference.objectId, reference.version);
      const appIds = usage.get(key) ?? new Set<string>();
      appIds.add(app.id);
      usage.set(key, appIds);
    }
  }

  return listThreadInventory()
    .flatMap((component) =>
      component.versions.map((version) => ({
        objectId: component.objectId,
        name: component.name,
        description: component.description,
        category: component.category,
        version: version.version,
        status: version.status,
        ownerTeam: component.owner.team,
        issueLabel: component.owner.issueLabel,
        packageName: version.code.packageName,
        exportName: version.code.exportName,
        figma: structuredClone(version.figma),
        quality: structuredClone(version.quality),
        appIds: [...(usage.get(referenceKey(component.objectId, version.version)) ?? [])],
        adoptionState: (version.status === 'approved' ? 'available' : 'blocked') as
          'available' | 'blocked',
      })),
    )
    .sort(
      (left, right) =>
        left.name.localeCompare(right.name) || left.version.localeCompare(right.version),
    );
}

export function threadInventoryManagementSummary(
  rows: ThreadInventoryManagementRow[],
): ThreadInventoryManagementSummary {
  return {
    componentCount: new Set(rows.map((row) => row.objectId)).size,
    versionCount: rows.length,
    approvedVersionCount: rows.filter((row) => row.status === 'approved').length,
    reviewVersionCount: rows.filter((row) => row.status === 'review').length,
    figmaMappedVersionCount: rows.filter((row) => row.figma.status !== 'unmapped').length,
  };
}
