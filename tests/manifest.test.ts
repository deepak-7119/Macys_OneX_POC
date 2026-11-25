import assert from 'node:assert/strict';
import test from 'node:test';
import type { AppManifest } from '../platform/contracts/index.ts';
import { getManifest, manifests, validateManifest } from '../platform/spool/src/manifests.ts';

function transactionManifest(): AppManifest {
  const manifest = manifests.find((item) => item.id === 'transaction-history');
  assert.ok(manifest, 'The transaction-history manifest must be registered');
  return structuredClone(manifest);
}

function rejectChange(change: (manifest: AppManifest) => void): void {
  const manifest = transactionManifest();
  change(manifest);
  assert.throws(() => validateManifest(manifest));
}

test('the registry contains exactly the two reviewed application manifests', () => {
  assert.deepEqual(manifests.map((manifest) => manifest.id).sort(), [
    'associate-communications',
    'transaction-history',
  ]);
  for (const manifest of manifests) {
    assert.deepEqual(validateManifest(structuredClone(manifest)), manifest);
    assert.deepEqual(getManifest(manifest.id), manifest);
  }
});

test('validated and retrieved manifests do not expose shared mutable approval objects', () => {
  const source = transactionManifest();
  const validated = validateManifest(source);
  const retrieved = getManifest(source.id);
  const retrievedAgain = getManifest(source.id);
  assert.ok(retrieved && retrievedAgain);
  assert.notStrictEqual(validated, source);
  assert.notStrictEqual(validated.operations, source.operations);
  assert.notStrictEqual(validated.componentRefs, source.componentRefs);
  assert.notStrictEqual(validated.componentRefs[0], source.componentRefs[0]);
  assert.notStrictEqual(validated.localComponents, source.localComponents);
  assert.notStrictEqual(validated.searchModes, source.searchModes);
  assert.notStrictEqual(validated.searchModes![0].fields, source.searchModes![0].fields);
  assert.notStrictEqual(retrieved, retrievedAgain);
  assert.notStrictEqual(retrieved.operations, retrievedAgain.operations);

  const operation = Object.keys(validated.operations)[0];
  validated.operations[operation] = '/api/unreviewed-operation';
  retrieved.operations[operation] = '/api/another-unreviewed-operation';
  assert.throws(() => validateManifest(validated));
  assert.throws(() => validateManifest(retrieved));
  assert.deepEqual(getManifest(source.id), source);
});

test('manifest validation rejects missing and malformed root values', () => {
  for (const value of [undefined, null, true, '', [], {}]) {
    assert.throws(() => validateManifest(value));
  }
  for (const key of [
    'id',
    'name',
    'eyebrow',
    'description',
    'icon',
    'version',
    'path',
    'entry',
    'launchMode',
    'capability',
    'operations',
    'componentRefs',
    'localComponents',
  ]) {
    const manifest = transactionManifest();
    Reflect.deleteProperty(manifest, key);
    assert.throws(() => validateManifest(manifest), `Missing ${key} must be rejected`);
  }
});

test('configuration cannot introduce another application or executable entry point', () => {
  rejectChange((manifest) => {
    Object.assign(manifest, { id: 'unreviewed-app' });
  });
  for (const entry of [
    'https://example.invalid/application.js',
    '//example.invalid/application.js',
    '/src/apps/unreviewed.tsx',
    '../apps/transaction-history.tsx',
    'javascript:alert(1)',
  ]) {
    rejectChange((manifest) => {
      manifest.entry = entry;
    });
  }
  const other = manifests.find((manifest) => manifest.id === 'associate-communications');
  assert.ok(other);
  rejectChange((manifest) => {
    manifest.entry = other.entry;
  });
  rejectChange((manifest) => {
    manifest.path = other.path;
  });
  rejectChange((manifest) => {
    manifest.path = 'https://example.invalid/';
  });
});

test('launch mode and required capability remain bound to the reviewed application', () => {
  for (const source of manifests) {
    const changedLaunch = structuredClone(source);
    changedLaunch.launchMode = source.launchMode === 'session' ? 'standalone' : 'session';
    assert.throws(() => validateManifest(changedLaunch));

    for (const capability of ['', 'admin:all', 'documents:read transactions:read']) {
      const changedCapability = structuredClone(source);
      changedCapability.capability = capability;
      assert.throws(() => validateManifest(changedCapability));
    }
  }
});

test('only registered versioned Thread references and reviewed local components may appear', () => {
  rejectChange((manifest) => {
    manifest.componentRefs.push({
      objectId: 'thread.component.unreviewed-script-widget',
      version: '1.0.0',
    });
  });
  rejectChange((manifest) => {
    Object.assign(manifest, { componentRefs: 'SearchForm' });
  });
  rejectChange((manifest) => {
    Object.assign(manifest, { componentRefs: [null] });
  });
  rejectChange((manifest) => {
    manifest.componentRefs.push(structuredClone(manifest.componentRefs[0]));
  });
  rejectChange((manifest) => {
    manifest.componentRefs[0].version = '99.0.0';
  });
  rejectChange((manifest) => {
    Object.assign(manifest, { localComponents: ['UnreviewedLocalWidget'] });
  });
  rejectChange((manifest) => {
    Object.assign(manifest, { localComponents: [] });
  });
});

test('operation mappings cannot target external servers or arbitrary local routes', () => {
  for (const target of [
    'https://example.invalid/transactions',
    '//example.invalid/transactions',
    'javascript:alert(1)',
    '/api/unreviewed-operation',
    '/api/../internal/admin',
    '/api/%2e%2e/internal/admin',
  ]) {
    rejectChange((manifest) => {
      const operation = Object.keys(manifest.operations)[0];
      assert.ok(operation, 'The transaction manifest must declare operations');
      manifest.operations[operation] = target;
    });
  }
  rejectChange((manifest) => {
    manifest.operations.unreviewedOperation = '/api/unreviewed-operation';
  });
});

test('every required application operation remains present with the reviewed binding', () => {
  for (const source of manifests) {
    assert.ok(Object.keys(source.operations).length > 0);
    for (const operation of Object.keys(source.operations)) {
      const missing = structuredClone(source);
      delete missing.operations[operation];
      assert.throws(() => validateManifest(missing), `${source.id}.${operation} is required`);

      const changed = structuredClone(source);
      changed.operations[operation] += '?upstream=https://example.invalid';
      assert.throws(
        () => validateManifest(changed),
        `${source.id}.${operation} cannot append a target`,
      );
    }
  }
  for (const operations of [null, [], 'https://example.invalid']) {
    rejectChange((manifest) => {
      Object.assign(manifest, { operations });
    });
  }
});

test('search configuration rejects malformed modes and field definitions', () => {
  const source = transactionManifest();
  assert.ok(source.searchModes?.length, 'TH must demonstrate manifest-configured search');
  assert.ok(source.searchModes[0].fields.length > 0);

  rejectChange((manifest) => {
    Object.assign(manifest, { searchModes: {} });
  });
  rejectChange((manifest) => {
    Object.assign(manifest, { searchModes: [null] });
  });
  rejectChange((manifest) => {
    Object.assign(manifest.searchModes![0], { fields: {} });
  });
  rejectChange((manifest) => {
    Object.assign(manifest.searchModes![0], { fields: [null] });
  });
  rejectChange((manifest) => {
    Object.assign(manifest.searchModes![0].fields[0], { type: 'executable-expression' });
  });
  rejectChange((manifest) => {
    Object.assign(manifest.searchModes![0].fields[0], { type: ['text'] });
  });
  rejectChange((manifest) => {
    Object.assign(manifest.searchModes![0].fields[0], { name: ['upc'] });
  });
  rejectChange((manifest) => {
    Object.assign(manifest.searchModes![0].fields[0], { name: '' });
  });
  rejectChange((manifest) => {
    Object.assign(manifest.searchModes![0].fields[0], { name: 'unreviewedBackendExpression' });
  });
  rejectChange((manifest) => {
    manifest.searchModes![0].fields = manifest.searchModes![0].fields.filter(
      (field) => field.name !== 'upc',
    );
  });
  rejectChange((manifest) => {
    Object.assign(manifest.searchModes![0].fields[0], { required: 'false' });
  });
  rejectChange((manifest) => {
    Object.assign(manifest.searchModes![0].fields[0], {
      type: 'select',
      options: [{ value: 'value-without-a-label' }],
    });
  });
});

test('duplicate mode IDs and duplicate field names cannot create ambiguous bindings', () => {
  rejectChange((manifest) => {
    manifest.searchModes!.push(structuredClone(manifest.searchModes![0]));
  });
  rejectChange((manifest) => {
    const fields = manifest.searchModes![0].fields;
    fields.push(structuredClone(fields[0]));
  });
});

test('search modes remain bound to reviewed application operations and field semantics', () => {
  rejectChange((manifest) => {
    manifest.searchModes![0].id = 'unreviewed-backend-operation';
  });
  for (const modeId of ['upc-date', 'upc-store-date']) {
    for (const [name, wrongType] of [
      ['upc', 'date'],
      ['fromDate', 'text'],
      ['toDate', 'text'],
    ]) {
      rejectChange((manifest) => {
        const field = manifest
          .searchModes!.find((mode) => mode.id === modeId)!
          .fields.find((item) => item.name === name)!;
        Object.assign(field, { type: wrongType });
      });
    }
    for (const name of ['upc', 'fromDate', 'toDate']) {
      rejectChange((manifest) => {
        const field = manifest
          .searchModes!.find((mode) => mode.id === modeId)!
          .fields.find((item) => item.name === name)!;
        field.required = false;
      });
      rejectChange((manifest) => {
        const field = manifest
          .searchModes!.find((mode) => mode.id === modeId)!
          .fields.find((item) => item.name === name)!;
        delete field.required;
      });
    }
  }
  rejectChange((manifest) => {
    manifest
      .searchModes!.find((mode) => mode.id === 'upc-date')!
      .fields.push({
        name: 'store',
        label: 'Store',
        type: 'select',
        required: true,
        options: [{ value: '1001', label: '1001 fixture' }],
      });
  });
  const communications = structuredClone(
    manifests.find((manifest) => manifest.id === 'associate-communications')!,
  );
  communications.searchModes = transactionManifest().searchModes;
  assert.throws(
    () => validateManifest(communications),
    'AC must not claim transaction search capabilities',
  );
  communications.searchModes = [];
  assert.throws(
    () => validateManifest(communications),
    'AC must not accept a transaction search configuration',
  );
});

test('store search requires a usable approved selector with unique bounded numeric values', () => {
  const source = transactionManifest();
  assert.ok(
    source.searchModes?.some((mode) => mode.id === 'upc-store-date'),
    'The approved store search mode must exist',
  );
  function changeStore(
    change: (field: NonNullable<AppManifest['searchModes']>[number]['fields'][number]) => void,
  ) {
    rejectChange((manifest) => {
      const mode = manifest.searchModes!.find((item) => item.id === 'upc-store-date')!;
      const field = mode.fields.find((item) => item.name === 'store')!;
      assert.ok(field);
      change(field);
    });
  }
  rejectChange((manifest) => {
    const mode = manifest.searchModes!.find((item) => item.id === 'upc-store-date')!;
    mode.fields = mode.fields.filter((field) => field.name !== 'store');
  });
  changeStore((field) => {
    field.type = 'text';
  });
  changeStore((field) => {
    field.required = false;
  });
  changeStore((field) => {
    delete field.required;
  });
  changeStore((field) => {
    field.options = [];
  });
  changeStore((field) => {
    field.options = [
      { value: '1001', label: 'First' },
      { value: '1001', label: 'Duplicate' },
    ];
  });
  for (const value of ['', 'https://example.invalid', '1001x', '12345678901']) {
    changeStore((field) => {
      field.options = [{ value, label: 'Unapproved store value' }];
    });
  }
  changeStore((field) => {
    Object.assign(field, {
      options: [{ value: 1001, label: 'Numeric values must remain strings' }],
    });
  });
  changeStore((field) => {
    field.options = [{ value: '1001', label: '' }];
  });

  const maximumWidth = transactionManifest();
  maximumWidth
    .searchModes!.find((mode) => mode.id === 'upc-store-date')!
    .fields.find((field) => field.name === 'store')!.options = [
    { value: '1234567890', label: 'Maximum-width fixture store' },
  ];
  assert.doesNotThrow(() => validateManifest(maximumWidth));
});
