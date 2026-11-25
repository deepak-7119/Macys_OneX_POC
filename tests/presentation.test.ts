import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PresentationSwitch } from '../platform/bobbin/shell/PresentationSwitch.tsx';
import {
  bindPresentationEvents,
  PRESENTATION_EVENT,
  presentationUrl,
  readPresentationMode,
  type PresentationMode,
} from '../platform/spool/src/presentation.ts';

test('presentation defaults to web and enables POS only for one exact view=pos parameter', () => {
  for (const url of [
    '/',
    '/apps/associate-communications',
    '/?view=web',
    '/?view=',
    '/?view=POS',
    '/?view=pos%20',
    '/?View=pos',
    '/?preview=pos',
    '/?view=pos&view=pos',
    '/?view=pos&view=web',
    '/?view=web&view=pos',
    'http://[invalid',
  ]) {
    assert.equal(readPresentationMode(url), 'web', url);
  }
  for (const url of [
    '/?view=pos',
    '/apps/associate-communications?fob=Home&view=pos#document',
    'https://example.test/apps/associate-communications?view=pos',
    '?view=pos',
  ]) {
    assert.equal(readPresentationMode(url), 'pos', url);
  }
});

test('presentation subscribers follow mode changes, browser history and routing, then clean up', () => {
  const target = new EventTarget();
  let url = '/?view=web';
  const observed: PresentationMode[] = [];
  const unbind = bindPresentationEvents(
    target,
    () => url,
    (mode) => observed.push(mode),
  );
  url = '/apps/associate-communications?view=pos';
  target.dispatchEvent(new Event(PRESENTATION_EVENT));
  url = '/apps/transaction-history?view=web';
  target.dispatchEvent(new Event('popstate'));
  url = '/?view=pos';
  target.dispatchEvent(new Event('single-spa:routing-event'));
  assert.deepEqual(observed, ['pos', 'web', 'pos']);
  unbind();
  url = '/?view=web';
  for (const event of [PRESENTATION_EVENT, 'popstate', 'single-spa:routing-event']) {
    target.dispatchEvent(new Event(event));
  }
  assert.deepEqual(observed, ['pos', 'web', 'pos'], 'unmount removes every subscription');
});

test('presentation links preserve internal app paths, other parameters and fragments', () => {
  const result = presentationUrl(
    '/apps/associate-communications?fob=Home&document=ac-101#page-2',
    'pos',
  );
  assert.ok(result.startsWith('/apps/associate-communications?'));
  const parsed = new URL(result, 'http://presentation.invalid');
  assert.equal(parsed.origin, 'http://presentation.invalid');
  assert.equal(parsed.pathname, '/apps/associate-communications');
  assert.equal(parsed.searchParams.get('fob'), 'Home');
  assert.equal(parsed.searchParams.get('document'), 'ac-101');
  assert.deepEqual(parsed.searchParams.getAll('view'), ['pos']);
  assert.equal(parsed.hash, '#page-2');
  assert.equal(readPresentationMode(result), 'pos');
});

test('mode switching replaces duplicate view parameters rather than adding another one', () => {
  for (const mode of ['web', 'pos'] as const) {
    const result = presentationUrl('/?view=pos&keep=1&view=web#apps', mode);
    const parsed = new URL(result, 'http://presentation.invalid');
    assert.deepEqual(parsed.searchParams.getAll('view'), [mode]);
    assert.equal(parsed.searchParams.get('keep'), '1');
    assert.equal(parsed.hash, '#apps');
    assert.equal(readPresentationMode(result), mode);
    assert.equal(presentationUrl(result, mode), result, 'reselecting a mode is stable');
  }
});

test('presentation link helper rejects external, scheme-relative and ambiguous navigation inputs', () => {
  for (const url of [
    '',
    'apps/associate-communications',
    '?view=pos',
    'https://example.test/apps/associate-communications',
    'http://127.0.0.1:4300/',
    'javascript:alert(1)',
    '//example.test/app',
    '/\\example.test/app',
    '/apps\\associate-communications',
    '/apps/associate-communications\n',
    '/apps/associate-communications?x=\u0000',
    '\t/apps/associate-communications',
  ]) {
    assert.throws(() => presentationUrl(url, 'pos'), JSON.stringify(url));
  }
  assert.throws(() => presentationUrl('/', 'native' as PresentationMode));
});

test('presentation selector exposes one pressed mode and uses non-submit buttons', () => {
  for (const mode of ['web', 'pos'] as const) {
    const html = renderToStaticMarkup(
      React.createElement(PresentationSwitch, { mode, onChange() {} }),
    );
    assert.match(html, /role="group" aria-label="Presentation mode"/);
    const buttons = [...html.matchAll(/<button\b([^>]*)>([^<]*)<\/button>/g)];
    assert.equal(buttons.length, 2);
    assert.equal(buttons.filter((button) => /aria-pressed="true"/.test(button[1])).length, 1);
    for (const button of buttons) {
      assert.match(button[1], /type="button"/);
      assert.match(button[1], /aria-pressed="(?:true|false)"/);
      assert.equal(
        /aria-pressed="true"/.test(button[1]),
        button[2] === `${mode === 'web' ? 'Web' : 'POS'} view`,
      );
    }
  }
});
