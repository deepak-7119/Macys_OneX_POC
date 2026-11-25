import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { manifests } from '../platform/spool/src/manifests.ts';
import {
  componentReuse,
  PlatformMap,
  reuseAudit,
} from '../platform/management/ManagementDashboard.tsx';

test('implementation map derives shared and single-app Thread inventory usage from manifests', () => {
  const reuse = componentReuse(manifests);
  assert.deepEqual(
    reuse.filter((item) => item.shared).map((item) => item.component),
    [
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
    ],
  );
  assert.deepEqual(
    reuse.filter((item) => !item.shared).map((item) => item.component),
    ['QueryForm', 'Tabs'],
  );
  assert.deepEqual(reuse.find((item) => item.component === 'QueryForm')?.appIds, [
    'transaction-history',
  ]);
  assert.equal(
    reuse.some((item) => item.component === 'Receipt'),
    false,
  );
  assert.equal(
    reuse.some((item) => item.component === 'DocumentViewer'),
    false,
  );
});

test('implementation map renders the one-Hub static-MFE flow for both apps', () => {
  const html = renderToStaticMarkup(
    React.createElement(PlatformMap, { apps: manifests, onClose() {} }),
  );
  for (const layer of ['Thread', 'Spool', 'MFE storage', 'OneX Hub', 'Bobbin'])
    assert.match(html, new RegExp(`>${layer}<`));
  for (const app of manifests) {
    assert.match(html, new RegExp(app.name));
    assert.ok(html.includes(app.path));
    assert.ok(html.includes(app.entry));
    assert.ok(html.includes(app.capability));
    for (const operation of Object.keys(app.operations))
      assert.match(html, new RegExp(`>${operation}<`));
  }
  assert.match(html, /aria-label="Platform request flow"/);
  assert.match(html, /aria-label="Close implementation map"/);
  assert.match(html, /Versioned Thread inventory usage/);
  assert.match(html, /thread\.component\.data-table@1\.0\.0/);
  assert.match(html, /Application-local/);
  assert.match(html, /Receipt/);
  assert.match(html, /DocumentViewer/);
  assert.match(html, /Shared patterns recovered from these two apps/);
  assert.match(html, /\/api\/binder\/v1\/apps\/associate-communications\/menu/);
  assert.match(html, /Apigee/);
  assert.match(html, /One Hub runtime, independently published MFEs/);
  for (const service of ['OneX Hub', 'MFE storage simulation', 'Shared session', 'Apigee mock'])
    assert.match(html, new RegExp(service));
  assert.match(html, /not UI containers/);
  assert.match(html, /internal POC name, not a confirmed/);
  assert.match(html, /PHASES 1–12/);
});

test('implementation map honors a capability-filtered application list', () => {
  const communications = manifests.filter((app) => app.id === 'associate-communications');
  const html = renderToStaticMarkup(
    React.createElement(PlatformMap, { apps: communications, onClose() {} }),
  );
  assert.match(html, /1 reviewed manifest/);
  assert.match(html, /data-runtime-app-id="associate-communications"/);
  assert.doesNotMatch(html, /data-runtime-app-id="transaction-history"/);
  assert.doesNotMatch(html, /Shared patterns recovered from these two apps/);
  assert.ok(componentReuse(communications).every((item) => !item.shared));
});

test('reuse audit identifies only patterns integrated in both current applications', () => {
  assert.deepEqual(
    reuseAudit.map((item) => item.component),
    ['ContextBar', 'RequestError', 'ResultsSummary', 'BackButton'],
  );
  assert.ok(
    reuseAudit.every(
      (item) =>
        item.appIds.includes('transaction-history') &&
        item.appIds.includes('associate-communications'),
    ),
  );
});

test('reuse audit shows real usage locations and contains no future roadmap', () => {
  const html = renderToStaticMarkup(
    React.createElement(PlatformMap, { apps: manifests, onClose() {} }),
  );
  assert.match(html, /working components used by both current app modules/);
  for (const component of ['ContextBar', 'RequestError', 'ResultsSummary', 'BackButton']) {
    assert.match(html, new RegExp(`data-audit-component="${component}"`));
  }
  assert.doesNotMatch(html, /Finish Line|Reference only|SearchSchema|StepFlow/);
});
