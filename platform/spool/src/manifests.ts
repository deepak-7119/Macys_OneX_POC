import type { AppManifest, FieldSpec } from '../../contracts/index.ts';
import type { ThreadComponentReference } from '../../thread/inventory/contracts.ts';
import {
  resolveThreadComponentReference,
  threadComponentReference,
} from '../../thread/inventory/registry.ts';
import { validateThreadComponentReference } from '../../thread/inventory/validation.ts';

const contracts = {
  'transaction-history': {
    entry: '/modules/transaction-history.js',
    path: '/apps/transaction-history',
    launchMode: 'session',
    capability: 'transactions:read',
    localComponents: ['Receipt'],
    operations: {
      query: '/api/apps/transaction-history/queries',
      detail: '/api/apps/transaction-history/transactions/{id}',
      receipt: '/api/apps/transaction-history/transactions/{id}/receipts/{variant}',
    },
  },
  'associate-communications': {
    entry: '/modules/associate-communications.js',
    path: '/apps/associate-communications',
    launchMode: 'standalone',
    capability: 'documents:read',
    localComponents: ['DocumentViewer'],
    operations: {
      menu: '/api/binder/v1/apps/associate-communications/menu',
      list: '/api/apps/associate-communications/documents',
      detail: '/api/apps/associate-communications/documents/{id}',
      page: '/api/apps/associate-communications/documents/{id}/pages/{page}',
    },
  },
} as const;

function threadRefs(...exportNames: string[]): ThreadComponentReference[] {
  return exportNames.map((name) => threadComponentReference(name, '1.0.0'));
}

const upcFields: FieldSpec[] = [
  { name: 'upc', label: 'UPC', type: 'text', required: true, placeholder: '000123456789' },
  { name: 'fromDate', label: 'From date', type: 'date', required: true },
  { name: 'toDate', label: 'To date', type: 'date', required: true },
];

export const manifests: AppManifest[] = [
  {
    id: 'transaction-history',
    name: 'Transaction History',
    eyebrow: 'SALES & SERVICE',
    description: 'Find a transaction. Understand its story. View the receipt.',
    icon: 'receipt',
    version: '1.0.0-poc',
    ...contracts['transaction-history'],
    operations: { ...contracts['transaction-history'].operations },
    searchModes: [
      { id: 'upc-date', label: 'UPC & date', fields: upcFields },
      {
        id: 'upc-store-date',
        label: 'UPC, store & date',
        fields: [
          upcFields[0],
          {
            name: 'store',
            label: 'Store',
            type: 'select',
            required: true,
            options: [
              { value: '1001', label: '1001 · Herald Square fixture' },
              { value: '1002', label: '1002 · Downtown fixture' },
            ],
          },
          ...upcFields.slice(1),
        ],
      },
    ],
    componentRefs: threadRefs(
      'BackButton',
      'Badge',
      'Button',
      'ContextBar',
      'DataTable',
      'Feedback',
      'PageHeader',
      'Panel',
      'QueryForm',
      'RequestError',
      'ResultsSummary',
      'Tabs',
    ),
  },
  {
    id: 'associate-communications',
    name: 'Associate Communications',
    eyebrow: 'KNOWLEDGE & TRAINING',
    description: 'Stay informed with training alerts and store communications.',
    icon: 'book',
    version: '1.0.0-poc',
    ...contracts['associate-communications'],
    operations: { ...contracts['associate-communications'].operations },
    componentRefs: threadRefs(
      'BackButton',
      'Badge',
      'Button',
      'ContextBar',
      'DataTable',
      'Feedback',
      'PageHeader',
      'Panel',
      'RequestError',
      'ResultsSummary',
    ),
  },
];

function fail(message: string): never {
  throw new Error(`Invalid manifest: ${message}`);
}
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function validateManifest(value: unknown): AppManifest {
  if (!record(value)) fail('expected an object');
  if (typeof value.id !== 'string' || !Object.hasOwn(contracts, value.id))
    fail('unknown application');
  const contract = contracts[value.id as keyof typeof contracts];
  for (const key of ['entry', 'path', 'launchMode', 'capability'] as const) {
    if (value[key] !== contract[key]) fail(`unapproved ${key}`);
  }
  for (const key of ['name', 'eyebrow', 'description', 'version']) {
    if (typeof value[key] !== 'string' || !value[key] || (value[key] as string).length > 500)
      fail(`missing or malformed ${key}`);
  }
  if (value.icon !== 'receipt' && value.icon !== 'book') fail('unknown icon');
  if (!Array.isArray(value.componentRefs) || !value.componentRefs.length)
    fail('missing Thread component references');
  const referencedObjectIds = new Set<string>();
  for (const candidate of value.componentRefs) {
    let reference: ThreadComponentReference;
    try {
      reference = validateThreadComponentReference(candidate);
    } catch {
      fail('malformed Thread component reference');
    }
    if (referencedObjectIds.has(reference.objectId)) fail('duplicate Thread component reference');
    referencedObjectIds.add(reference.objectId);
    if (!resolveThreadComponentReference(reference))
      fail('unregistered Thread component reference');
  }
  if (
    !Array.isArray(value.localComponents) ||
    value.localComponents.length !== contract.localComponents.length ||
    value.localComponents.some((component, index) => component !== contract.localComponents[index])
  )
    fail('unapproved application-local component');
  if (!record(value.operations)) fail('missing operations');
  const expected = contract.operations as Record<string, string>;
  if (Object.keys(value.operations).length !== Object.keys(expected).length)
    fail('missing or extra operation');
  for (const [key, route] of Object.entries(value.operations))
    if (route !== expected[key] || !Object.hasOwn(expected, key))
      fail('unapproved operation route');
  if (
    value.id === 'transaction-history' &&
    (!Array.isArray(value.searchModes) || !value.searchModes.length)
  )
    fail('missing search modes');
  if (value.id === 'associate-communications' && value.searchModes !== undefined)
    fail('search modes are not registered for this application');
  if (value.searchModes !== undefined) {
    if (!Array.isArray(value.searchModes)) fail('malformed search modes');
    const modeIds = new Set<string>();
    for (const mode of value.searchModes) {
      if (
        !record(mode) ||
        typeof mode.id !== 'string' ||
        !/^[a-z][a-z0-9-]{0,50}$/.test(mode.id) ||
        typeof mode.label !== 'string' ||
        !mode.label ||
        !Array.isArray(mode.fields) ||
        !mode.fields.length
      )
        fail('malformed search mode');
      if (!['upc-date', 'upc-store-date'].includes(mode.id)) fail('unsupported search mode');
      if (modeIds.has(mode.id)) fail('duplicate mode');
      modeIds.add(mode.id);
      const names = new Set<string>();
      for (const field of mode.fields) {
        if (
          !record(field) ||
          typeof field.name !== 'string' ||
          !['upc', 'fromDate', 'toDate', 'store'].includes(field.name) ||
          typeof field.label !== 'string' ||
          !field.label ||
          typeof field.type !== 'string' ||
          !['text', 'date', 'select'].includes(field.type)
        )
          fail('malformed field');
        if (names.has(field.name)) fail('duplicate field');
        names.add(field.name);
        if (field.required !== undefined && typeof field.required !== 'boolean')
          fail('malformed field requirement');
        if (
          field.type === 'select' &&
          (!Array.isArray(field.options) ||
            !field.options.length ||
            field.options.some(
              (o: unknown) =>
                !record(o) || typeof o.value !== 'string' || typeof o.label !== 'string',
            ))
        )
          fail('malformed field options');
      }
      if (!['upc', 'fromDate', 'toDate'].every((name) => names.has(name)))
        fail('missing query field');
      for (const [name, type] of [
        ['upc', 'text'],
        ['fromDate', 'date'],
        ['toDate', 'date'],
      ]) {
        const field = mode.fields.find((item: Record<string, unknown>) => item.name === name);
        if (field.type !== type || field.required !== true)
          fail('query field does not match the operation contract');
      }
      const store = mode.fields.find((item: Record<string, unknown>) => item.name === 'store');
      if (mode.id === 'upc-date' && store) fail('store is not part of this operation');
      if (mode.id === 'upc-store-date') {
        if (!store || store.type !== 'select' || store.required !== true)
          fail('store selection is required');
        const options = store.options as Array<{ value: string; label: string }>;
        if (
          options.some((option) => !/^\d{1,10}$/.test(option.value) || !option.label.trim()) ||
          new Set(options.map((option) => option.value)).size !== options.length
        )
          fail('invalid or duplicate store option');
      }
    }
  }
  return structuredClone(value) as unknown as AppManifest;
}

manifests.forEach(validateManifest);
export function getManifest(id: string): AppManifest | undefined {
  const manifest = manifests.find((app) => app.id === id);
  return manifest ? validateManifest(manifest) : undefined;
}
