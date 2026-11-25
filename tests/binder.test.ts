import assert from 'node:assert/strict';
import test from 'node:test';
import type { BinderMenu } from '../platform/binder/contracts/menu.ts';
import { validateBinderMenu } from '../platform/binder/client/index.ts';
import { buildBobbin } from '../platform/bobbin/server/bobbin.ts';
import { getManifest } from '../platform/spool/src/manifests.ts';
import { operationPath } from '../platform/spool/src/client.ts';

test('Associate Communications menu is an approved Binder operation', () => {
  const manifest = getManifest('associate-communications')!;
  assert.equal(
    operationPath(manifest, 'menu'),
    '/api/binder/v1/apps/associate-communications/menu',
  );
});

test('mock Binder loads a complete POS menu using session context', async (t) => {
  const bobbin = buildBobbin({ upstreamUrl: 'http://127.0.0.1:4301' });
  t.after(() => bobbin.close());
  const response = await bobbin.inject('/api/binder/v1/apps/associate-communications/menu');
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['cache-control'], 'no-store');
  const menu = validateBinderMenu(response.json()) as BinderMenu;
  assert.deepEqual(menu.context, { division: '71', store: '1001', presentation: 'pos' });
  assert.deepEqual(
    menu.items.map((item) => item.key),
    [1, 2, 3, 4, 5, 6, 7, 8],
  );
  assert.deepEqual(
    menu.items.filter((item) => !item.disabled).map((item) => item.action),
    ['training-alerts', 'communication-menu', 'exit'],
  );
});

test('Binder client rejects incomplete, duplicate and executable menu contracts', () => {
  const valid = {
    appId: 'associate-communications',
    source: 'mock',
    context: { division: '71', store: '1001', presentation: 'pos' },
    items: Array.from({ length: 8 }, (_, index) => ({
      key: index + 1,
      label: `Menu ${index + 1}`,
      disabled: true,
    })),
  };
  assert.doesNotThrow(() => validateBinderMenu(valid));
  assert.throws(() => validateBinderMenu({ ...valid, items: valid.items.slice(0, 7) }));
  assert.throws(() =>
    validateBinderMenu({ ...valid, items: valid.items.map((item) => ({ ...item, key: 1 })) }),
  );
  assert.throws(() =>
    validateBinderMenu({
      ...valid,
      items: valid.items.map((item, index) =>
        index === 0 ? { ...item, action: 'javascript:alert(1)' } : item,
      ),
    }),
  );
});
