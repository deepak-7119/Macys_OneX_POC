import assert from 'node:assert/strict';
import test from 'node:test';
import { bindNavigationEvents } from '../platform/spool/src/navigation.ts';

test('a module-load error remains visible after the completed single-spa reroute', () => {
  const target = new EventTarget();
  let path = '/';
  let currentPath = path;
  let error = '';
  const unbind = bindNavigationEvents(
    target,
    () => path,
    (value) => {
      currentPath = value;
    },
    () => {
      error = '';
    },
  );
  target.dispatchEvent(new Event('single-spa:before-routing-event'));
  path = '/apps/transaction-history';
  error = 'Module unavailable';
  target.dispatchEvent(new Event('single-spa:routing-event'));
  assert.equal(currentPath, path);
  assert.equal(error, 'Module unavailable');
  target.dispatchEvent(new Event('popstate'));
  assert.equal(error, 'Module unavailable');
  target.dispatchEvent(new Event('single-spa:before-routing-event'));
  assert.equal(error, '');
  unbind();
  path = '/unobserved';
  target.dispatchEvent(new Event('single-spa:routing-event'));
  assert.equal(currentPath, '/apps/transaction-history');
});
