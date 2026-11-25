import type { AppManifest } from '../../contracts/index.ts';
import { api, operationPath } from '../../spool/src/client.ts';
import type { BinderMenu, BinderMenuAction, BinderMenuItem } from '../contracts/menu.ts';

const actions = new Set<BinderMenuAction>(['training-alerts', 'communication-menu', 'exit']);

function isMenuItem(value: unknown): value is BinderMenuItem {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return (
    Number.isInteger(item.key) &&
    Number(item.key) >= 1 &&
    Number(item.key) <= 8 &&
    typeof item.label === 'string' &&
    item.label.length > 0 &&
    item.label.length <= 80 &&
    typeof item.disabled === 'boolean' &&
    (item.hint === undefined || typeof item.hint === 'string') &&
    (item.action === undefined || actions.has(item.action as BinderMenuAction))
  );
}

export function validateBinderMenu(value: unknown): BinderMenu {
  if (!value || typeof value !== 'object') throw new Error('Binder returned an invalid menu.');
  const menu = value as BinderMenu;
  if (
    menu.appId !== 'associate-communications' ||
    menu.source !== 'mock' ||
    !menu.context ||
    typeof menu.context.division !== 'string' ||
    typeof menu.context.store !== 'string' ||
    menu.context.presentation !== 'pos' ||
    !Array.isArray(menu.items) ||
    menu.items.length !== 8 ||
    menu.items.some((item) => !isMenuItem(item)) ||
    new Set(menu.items.map((item) => item.key)).size !== menu.items.length
  ) {
    throw new Error('Binder returned an invalid menu.');
  }
  return menu;
}

export async function loadCommunicationsMenu(
  manifest: AppManifest,
  options: RequestInit = {},
): Promise<BinderMenu> {
  return validateBinderMenu(await api(operationPath(manifest, 'menu'), options));
}
