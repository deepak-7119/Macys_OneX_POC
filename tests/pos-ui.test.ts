import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  getCommunicationsPosCommands,
  posKeyboardCommand,
  PosCommunicationMenu,
  PosCommunicationsFrame,
  PosExitScreen,
  PosFunctionRail,
} from '../applications/associate-communications/src/presentation/pos/communications-pos.tsx';
import { usePresentationMode } from '../platform/spool/src/presentation.ts';
import type { BinderMenuItem } from '../platform/binder/contracts/menu.ts';

const binderMenu: BinderMenuItem[] = [
  { key: 1, label: 'Training Alerts', action: 'training-alerts', disabled: false },
  { key: 2, label: 'Product Warranties', hint: 'Not in this POC', disabled: true },
  { key: 3, label: 'POS Quick Tips', hint: 'Not in this POC', disabled: true },
  { key: 4, label: 'Color Your Day / Other', hint: 'Not in this POC', disabled: true },
  { key: 5, label: 'Not assigned', disabled: true },
  { key: 6, label: 'Not assigned', disabled: true },
  { key: 7, label: 'Communication Menu', action: 'communication-menu', disabled: false },
  { key: 8, label: 'Exit to POS', hint: 'Simulated', action: 'exit', disabled: false },
];

function posCommands(
  screen: Parameters<typeof getCommunicationsPosCommands>[0],
  view: Parameters<typeof getCommunicationsPosCommands>[1],
  hasDocument = false,
) {
  return getCommunicationsPosCommands(screen, view, hasDocument, binderMenu);
}

test('POS presentation keeps eight labelled keys but enables only implemented workflows', () => {
  const commands = posCommands('menu', 'list');
  assert.deepEqual(
    commands.map((command) => command.key),
    [1, 2, 3, 4, 5, 6, 7, 8],
  );
  assert.deepEqual(
    commands.filter((command) => !command.disabled).map((command) => command.action),
    ['training-alerts', 'communication-menu', 'exit'],
  );
  for (const key of [2, 3, 4, 5, 6]) {
    const command = commands.find((item) => item.key === key)!;
    assert.equal(command.disabled, true);
    assert.equal(command.action, undefined);
  }
  assert.match(commands[7].hint!, /Simulated/);
});

test('POS document keys gate unavailable data and never enable physical printing', () => {
  for (const view of ['detail', 'viewer'] as const) {
    for (const hasDocument of [false, true]) {
      const commands = posCommands('communications', view, hasDocument);
      assert.equal(commands[0].label, 'Print Barcode');
      assert.equal(commands[0].disabled, true);
      assert.equal(commands[0].action, undefined);
      assert.match(commands[0].hint!, /not connected/i);
      assert.equal(commands[1].disabled, !hasDocument);
      assert.equal(commands[1].action, view === 'viewer' ? 'document-details' : 'view-pages');
      assert.equal(commands[5].action, 'training-alerts');
    }
  }
});

test('POS shortcuts select active Alt+number commands and leave native function keys alone', () => {
  const commands = posCommands('menu', 'list');
  assert.equal(posKeyboardCommand({ key: '1', altKey: true }, commands), 'training-alerts');
  assert.equal(posKeyboardCommand({ key: '7', altKey: true }, commands), 'communication-menu');
  assert.equal(posKeyboardCommand({ key: '8', altKey: true }, commands), 'exit');
  for (const key of ['0', '2', '3', '4', '5', '6', '9', 'F1', 'F8', 'Enter', 'Escape']) {
    assert.equal(posKeyboardCommand({ key, altKey: true }, commands), undefined, key);
  }
  assert.equal(posKeyboardCommand({ key: '1', altKey: false }, commands), undefined);
});

test('POS shortcuts do not interrupt editable fields, other modifier chords or handled/repeating keys', () => {
  const commands = posCommands('menu', 'list');
  const event = { key: '1', altKey: true };
  assert.equal(posKeyboardCommand(event, commands, true), undefined);
  for (const extra of [
    { ctrlKey: true },
    { metaKey: true },
    { shiftKey: true },
    { repeat: true },
    { defaultPrevented: true },
  ]) {
    assert.equal(posKeyboardCommand({ ...event, ...extra }, commands), undefined);
  }
  const loading = posCommands('communications', 'detail', false);
  assert.equal(posKeyboardCommand({ key: '2', altKey: true }, loading), undefined);
  const ready = posCommands('communications', 'detail', true);
  assert.equal(posKeyboardCommand({ key: '2', altKey: true }, ready), 'view-pages');
});

test('POS function rail exposes correct accessible shortcuts and disables unsupported keys', () => {
  const html = renderToStaticMarkup(
    React.createElement(PosFunctionRail, {
      commands: posCommands('menu', 'list'),
      onCommand() {},
    }),
  );
  assert.match(html, /<nav[^>]*aria-label="POS function keys"/);
  const buttons = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)];
  assert.equal(buttons.length, 8);
  assert.equal(buttons.filter((button) => /disabled=""/.test(button[1])).length, 5);
  for (const button of buttons) {
    assert.match(button[1], /type="button"/);
    if (/disabled=""/.test(button[1])) assert.doesNotMatch(button[1], /aria-keyshortcuts/);
    else assert.match(button[1], /aria-keyshortcuts="Alt\+[178]"/);
  }
  assert.match(html, /Exit to POS/);
  assert.match(html, /Simulated/);
});

test('POS menu and exit screens distinguish presentation preview from live POS capabilities', () => {
  const menu = renderToStaticMarkup(
    React.createElement(PosCommunicationMenu, {
      commands: posCommands('menu', 'list'),
      loading: false,
      onRetry() {},
      onCommand() {},
    }),
  );
  assert.match(menu, /<h1 tabindex="-1">Communication Menu<\/h1>/);
  assert.equal([...menu.matchAll(/<button\b/g)].length, 4);
  assert.equal([...menu.matchAll(/<button\b[^>]*disabled=""/g)].length, 3);
  assert.match(menu, /Only Training Alerts is implemented/);
  assert.match(menu, /register hardware and live offers are not connected/);
  const exit = renderToStaticMarkup(React.createElement(PosExitScreen, { onReturn() {} }));
  assert.match(exit, /POS main menu · simulated/);
  assert.match(exit, /has not opened or closed another application/);
  assert.match(exit, /Return to Associate Communications/);
});

test('POS frame retains store context and SSR defaults to web without touching browser globals', () => {
  function Mode() {
    return React.createElement('span', null, usePresentationMode());
  }
  const html = renderToStaticMarkup(
    React.createElement(PosCommunicationsFrame, {
      commands: posCommands('menu', 'list'),
      onCommand() {},
      division: '71',
      store: '1001',
      children: React.createElement(Mode),
    }),
  );
  assert.match(html, /Division 71 · Store 1001 · Synthetic POS context/);
  assert.match(html, /aria-label="Associate Communications POS workspace"/);
  assert.match(html, /<span>web<\/span>/);
});
