import type { ThreadInventoryComponent } from '../inventory/contracts.ts';
import { listThreadInventory } from '../inventory/registry.ts';
import { validateThreadInventoryComponent } from '../inventory/validation.ts';
import { ThreadReleaseDataError, type ThreadReleaseRepository } from './repository.ts';

export type ThreadInventoryCatalogProvider = () => Promise<ThreadInventoryComponent[]>;

export async function listThreadInventoryCatalog(
  releases: ThreadReleaseRepository,
): Promise<ThreadInventoryComponent[]> {
  const items = [
    ...listThreadInventory(),
    ...(await releases.list()).map((release) => validateThreadInventoryComponent(release.component)),
  ];
  if (
    new Set(items.map((item) => item.objectId)).size !== items.length ||
    new Set(items.map((item) => item.name)).size !== items.length
  )
    throw new ThreadReleaseDataError('Thread catalog contains duplicate component identities.');
  return items;
}
