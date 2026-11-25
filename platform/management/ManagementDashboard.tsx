import React from 'react';
import type { AppManifest } from '../contracts/index.ts';
import { Badge, Button } from '../thread/src/index.tsx';
import { resolveThreadComponentReference } from '../thread/inventory/registry.ts';
import {
  threadInventoryManagementRows,
  threadInventoryManagementSummary,
} from './threadInventory.ts';
import { discoverThreadComponents } from '../thread/discovery/service.ts';

export interface ComponentReuse {
  component: string;
  appIds: string[];
  shared: boolean;
}

export function componentReuse(apps: AppManifest[]): ComponentReuse[] {
  const usage = new Map<string, string[]>();
  for (const app of apps) {
    for (const reference of app.componentRefs) {
      const resolved = resolveThreadComponentReference(reference);
      if (!resolved) throw new Error(`Unresolved Thread component: ${reference.objectId}`);
      const component = resolved.component.name;
      const appIds = usage.get(component) ?? [];
      if (!appIds.includes(app.id)) appIds.push(app.id);
      usage.set(component, appIds);
    }
  }
  return [...usage.entries()]
    .map(([component, appIds]) => ({ component, appIds, shared: appIds.length > 1 }))
    .sort(
      (left, right) =>
        Number(right.shared) - Number(left.shared) || left.component.localeCompare(right.component),
    );
}

export const reuseAudit = [
  {
    component: 'ContextBar',
    appIds: ['transaction-history', 'associate-communications'],
    transactionUse: 'Synthetic-data notice plus division and store context',
    communicationsUse: 'Fixture-date notice plus division and store context',
  },
  {
    component: 'RequestError',
    appIds: ['transaction-history', 'associate-communications'],
    transactionUse: 'Query/detail failures, field messages, retry and request ID',
    communicationsUse: 'List/detail failures, retry and request ID',
  },
  {
    component: 'ResultsSummary',
    appIds: ['transaction-history', 'associate-communications'],
    transactionUse: 'Displayed/total transaction counts and currency',
    communicationsUse: 'Displayed/eligible alert counts and fixture date',
  },
  {
    component: 'BackButton',
    appIds: ['transaction-history', 'associate-communications'],
    transactionUse: 'Return from transaction detail or receipt',
    communicationsUse: 'Return from alert detail or document viewer',
  },
] as const;

const qualityGateLabels = {
  tests: 'Tests',
  accessibility: 'Accessibility',
  designReview: 'Design',
  securityReview: 'Security',
} as const;

export const candidatePipelineStages = [
  {
    status: 'requested',
    title: 'Request',
    actor: 'Agent or engineer',
    description: 'An inventory miss becomes a typed request with a stable proposed object ID.',
  },
  {
    status: 'candidate',
    title: 'Candidate',
    actor: 'Agent or engineer',
    description:
      'Attach versioned React code and a source binding; the agent may record test evidence.',
  },
  {
    status: 'review',
    title: 'Human review',
    actor: 'Designer and engineer',
    description: 'Accessibility, design and security evidence is recorded or returned for rework.',
  },
  {
    status: 'approved',
    title: 'Governance approval',
    actor: 'Governance only',
    description: 'All four gates must pass before an inventory-ready component record is produced.',
  },
] as const;

export const buildJobStages = [
  {
    status: 'queued',
    title: 'Queued',
    description: 'A durable job points to one validated inventory-gap request.',
  },
  {
    status: 'running',
    title: 'Claimed',
    description: 'An agent or engineer role claims the job before producing output.',
  },
  {
    status: 'candidate-ready',
    title: 'Candidate ready',
    description: 'Code bindings and test evidence remain inert until an artifact is verified.',
  },
  {
    status: 'attached',
    title: 'Attached',
    description: 'A verified artifact unlocks copying the candidate into governed review.',
  },
] as const;

export const artifactStages = [
  {
    title: 'Stage manifest',
    description: 'Bind the exact job candidate to a bounded package manifest.',
  },
  {
    title: 'Identify content',
    description: 'Record SHA-256, archive size, media type, build log and SBOM references.',
  },
  {
    title: 'Verify policy evidence',
    description: 'An engineer records provenance, dependency-audit and license-review results.',
  },
  {
    title: 'Unlock attachment',
    description: 'Only one verified artifact for the exact job may cross into request review.',
  },
] as const;

export const automationStages = [
  {
    title: 'Resolve design fixture',
    description: 'The mock Figma adapter accepts a reviewed fixture ID, never a URL or token.',
  },
  {
    title: 'Search inventory first',
    description: 'Existing and related Thread records stop automatic component creation.',
  },
  {
    title: 'Build controlled template',
    description: 'A replaceable builder selects inert source from a reviewed static template.',
  },
  {
    title: 'Inspect on server',
    description: 'Bobbin creates an in-memory gzip and computes its SHA-256 and byte size.',
  },
  {
    title: 'Stage for review',
    description: 'The manifest enters Phase 9 quarantine; human verification remains mandatory.',
  },
] as const;

export const releaseStages = [
  {
    title: 'Complete human review',
    description: 'Tests, accessibility, design and security evidence must all pass.',
  },
  {
    title: 'Promote exact evidence chain',
    description: 'Governance binds the approved request to its attached job and verified artifact.',
  },
  {
    title: 'Publish to runtime catalog',
    description: 'The approved component snapshot joins inventory without rewriting the baseline.',
  },
  {
    title: 'Reuse in later apps',
    description: 'Discovery returns the permanent object ID and approved semantic version.',
  },
  {
    title: 'Rollback without deletion',
    description: 'Governance records evidence and deprecates the version while preserving history.',
  },
] as const;

const deliveryPhaseGroups = [
  {
    phase: 'Phases 1–4',
    title: 'Establish inventory',
    items: 'Contracts · 12 component records · versioned Spool references · management inventory',
  },
  {
    phase: 'Phases 5–7',
    title: 'Govern demand',
    items: 'Candidate workflow · protected durable APIs · inventory-first discovery',
  },
  {
    phase: 'Phases 8–10',
    title: 'Control automation',
    items: 'Build jobs · artifact quarantine · replaceable Figma/agent adapters',
  },
  {
    phase: 'Phase 11',
    title: 'Release and reuse',
    items: 'Governance promotion · runtime catalog · rollback audit · final handoff',
  },
  {
    phase: 'Phase 12',
    title: 'Prove deployment boundaries',
    items:
      'One Hub root config · storage-hosted MFE bundles · shared session · Apigee and backend simulation',
  },
] as const;

const topologyNodes = [
  {
    name: 'OneX Hub',
    detail: 'One single-spa root config; Bobbin is the temporary fallback host and API boundary',
  },
  {
    name: 'MFE storage simulation',
    detail: 'Publishes TH and AC JavaScript as independent static bundles, shaped like GCP Storage',
  },
  {
    name: 'Shared session',
    detail: 'Synthetic stand-in for the unresolved enterprise IDM boundary',
  },
  { name: 'Apigee mock', detail: 'Simulated API policy and backend gateway boundary' },
  { name: 'Legacy backend', detail: 'Synthetic source-shaped transaction and document APIs' },
] as const;

const layers = [
  {
    name: 'Thread',
    slug: 'thread',
    role: 'Build the UI',
    description:
      'Provides versioned React components and tokens that are bundled into each micro-frontend at build time.',
  },
  {
    name: 'Spool',
    slug: 'spool',
    role: 'Create and register',
    description:
      'Provides the project/root-config pattern, validates each manifest and registers the route and versioned entry module.',
  },
  {
    name: 'MFE storage',
    slug: 'storage',
    role: 'Publish static assets',
    description:
      'Serves independently built TH and AC bundles from a separate origin that simulates GCP Cloud Storage.',
  },
  {
    name: 'OneX Hub',
    slug: 'hub',
    role: 'Orchestrate at runtime',
    description:
      'Runs one single-spa root application and lazy-loads only the selected micro-frontend into the same browser view.',
  },
  {
    name: 'Bobbin',
    slug: 'bobbin',
    role: 'Fallback boundary',
    description:
      'Temporarily supplies the Hub host, session and API proxy while Enterprise Architecture proves the replacement edge services.',
  },
] as const;

export function PlatformMap({ apps, onClose }: { apps: AppManifest[]; onClose: () => void }) {
  const reuse = componentReuse(apps);
  const inventoryRows = threadInventoryManagementRows(apps);
  const inventorySummary = threadInventoryManagementSummary(inventoryRows);
  const discoveryProbe = discoverThreadComponents({
    requestId: 'thread.request.management-button-probe',
    objectId: 'thread.component.button',
    name: 'Button',
    description: 'Shared button primitive with primary, secondary and ghost variants.',
    category: 'primitive',
    owner: { team: 'Thread Platform', issueLabel: 'thread:management-probe' },
    source: {
      kind: 'application',
      appId: 'management-view',
      sourcePath: 'platform/management/ManagementDashboard.tsx',
    },
  });
  const appNames = new Map<string, string>(apps.map((app) => [app.id, app.name]));
  const availableIds = new Set(apps.map((app) => app.id));
  const visibleAudit = reuseAudit.filter((item) =>
    item.appIds.every((appId) => availableIds.has(appId)),
  );
  return (
    <section
      className="implementation-map"
      id="implementation-map"
      aria-labelledby="implementation-map-heading"
    >
      <header className="implementation-map__header">
        <div>
          <span className="eyebrow">LIVE POC ARCHITECTURE</span>
          <h2 id="implementation-map-heading">How one Hub loads independent micro-frontends</h2>
          <p>This view is built from the application manifests available to the current session.</p>
        </div>
        <Button variant="ghost" onClick={onClose} aria-label="Close implementation map">
          Close <span aria-hidden="true">×</span>
        </Button>
      </header>

      <ol className="platform-flow" aria-label="Platform request flow">
        {layers.map((layer, index) => (
          <li className={`platform-flow__step platform-flow__step--${layer.slug}`} key={layer.name}>
            <span className="platform-flow__number" aria-hidden="true">
              {index + 1}
            </span>
            <div>
              <div className="platform-flow__title">
                <h3>{layer.name}</h3>
                <Badge tone="accent">{layer.role}</Badge>
              </div>
              <p>{layer.description}</p>
            </div>
            {index < layers.length - 1 && (
              <span className="platform-flow__arrow" aria-hidden="true">
                →
              </span>
            )}
          </li>
        ))}
      </ol>

      <section className="phase-delivery-map" aria-labelledby="runtime-topology-heading">
        <div className="implementation-map__section-heading">
          <div>
            <span className="eyebrow">LATEST CLIENT FLOW SIMULATION</span>
            <h3 id="runtime-topology-heading">One Hub runtime, independently published MFEs</h3>
          </div>
          <Badge tone="success">Running on HTTP boundaries</Badge>
        </div>
        <p className="phase-delivery-map__note">
          The Hub owns navigation and session context. TH and AC are not UI containers: their static
          bundles are fetched from the storage simulation and mounted into the same page. Bobbin
          remains only as the current fallback for the capabilities that Enterprise Architecture has
          not yet demonstrated.
        </p>
        <ol className="phase-delivery-map__groups" aria-label="Local runtime services">
          {topologyNodes.map((node, index) => (
            <li key={node.name}>
              <span className="eyebrow">SERVICE {index + 1}</span>
              <strong>{node.name}</strong>
              <p>{node.detail}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="phase-delivery-map" aria-labelledby="phase-delivery-map-heading">
        <div className="implementation-map__section-heading">
          <div>
            <span className="eyebrow">POC DELIVERY MAP · PHASES 1–12</span>
            <h3 id="phase-delivery-map-heading">How the implementation was built</h3>
          </div>
          <Badge tone="success">12 governed phase gates</Badge>
        </div>
        <p className="phase-delivery-map__note">
          Management view: each group states the outcome and control added. Detailed APIs and
          evidence remain in the sections below and in the phase handoff document.
        </p>
        <ol className="phase-delivery-map__groups" aria-label="POC delivery phases">
          {deliveryPhaseGroups.map((group) => (
            <li key={group.phase}>
              <span className="eyebrow">{group.phase}</span>
              <strong>{group.title}</strong>
              <p>{group.items}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="manifest-map" aria-labelledby="manifest-map-heading">
        <div className="implementation-map__section-heading">
          <div>
            <span className="eyebrow">SPOOL IN THIS POC</span>
            <h3 id="manifest-map-heading">Actual application wiring</h3>
          </div>
          <span>
            {apps.length} reviewed {apps.length === 1 ? 'manifest' : 'manifests'}
          </span>
        </div>
        <div className="manifest-grid">
          {apps.map((app) => (
            <article className="manifest-card" data-runtime-app-id={app.id} key={app.id}>
              <div className="manifest-card__title">
                <div>
                  <span className="eyebrow">{app.id}</span>
                  <h4>{app.name}</h4>
                </div>
                <Badge>{app.version}</Badge>
              </div>
              <dl>
                <div>
                  <dt>Route</dt>
                  <dd>
                    <code>{app.path}</code>
                  </dd>
                </div>
                <div>
                  <dt>Bundle</dt>
                  <dd>
                    <code>{app.entry}</code>
                  </dd>
                </div>
                <div>
                  <dt>Launch</dt>
                  <dd>{app.launchMode}</dd>
                </div>
                <div>
                  <dt>Capability</dt>
                  <dd>
                    <code>{app.capability}</code>
                  </dd>
                </div>
              </dl>
              <div className="operation-list" aria-label={`${app.name} named operations`}>
                {Object.keys(app.operations).map((operation) => (
                  <span key={operation}>{operation}</span>
                ))}
              </div>
              <div
                className="component-reference-list"
                aria-label={`${app.name} Thread inventory references`}
              >
                <strong>Thread inventory</strong>
                {app.componentRefs.map((reference) => (
                  <code key={reference.objectId}>
                    {reference.objectId}@{reference.version}
                  </code>
                ))}
              </div>
              <div
                className="local-component-list"
                aria-label={`${app.name} application-local components`}
              >
                <strong>Application-local</strong>
                {app.localComponents.map((component) => (
                  <span key={component}>{component}</span>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="binder-map" aria-labelledby="binder-map-heading">
        <div className="implementation-map__section-heading">
          <div>
            <span className="eyebrow">POC API ADAPTER</span>
            <h3 id="binder-map-heading">Data loads are separate from UI composition</h3>
          </div>
          <Badge tone="success">Live mock API</Badge>
        </div>
        <div className="binder-callout">
          <div>
            <strong>Associate Communications POS menu</strong>
            <p>
              The eight menu buttons load through a typed POC adapter using the current capability,
              division and store context. “Binder” is an internal POC name, not a confirmed Overlock
              platform product.
            </p>
          </div>
          <code>/api/binder/v1/apps/associate-communications/menu</code>
        </div>
      </section>

      <section className="reuse-map" aria-labelledby="reuse-map-heading">
        <div className="implementation-map__section-heading">
          <div>
            <span className="eyebrow">THREAD IN THIS POC</span>
            <h3 id="reuse-map-heading">Versioned Thread inventory usage</h3>
          </div>
          <span>Shared components are implemented once</span>
        </div>
        <div
          className="thread-table-scroll"
          role="region"
          aria-label="Thread component reuse"
          tabIndex={0}
        >
          <table className="thread-table reuse-table">
            <thead>
              <tr>
                <th scope="col">Thread component</th>
                <th scope="col">Classification</th>
                {apps.map((app) => (
                  <th scope="col" key={app.id}>
                    {app.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {reuse.map((row) => (
                <tr key={row.component}>
                  <th scope="row">
                    <code>{row.component}</code>
                  </th>
                  <td>
                    <Badge tone={row.shared ? 'success' : 'neutral'}>
                      {row.shared ? 'Reused' : 'Single app'}
                    </Badge>
                  </td>
                  {apps.map((app) => (
                    <td
                      key={app.id}
                      className={row.appIds.includes(app.id) ? 'is-used' : 'is-unused'}
                    >
                      {row.appIds.includes(app.id) ? '✓ Used' : '—'}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="inventory-catalog" aria-labelledby="inventory-catalog-heading">
        <div className="implementation-map__section-heading">
          <div>
            <span className="eyebrow">THREAD MANAGEMENT INVENTORY</span>
            <h3 id="inventory-catalog-heading">Governed component records</h3>
          </div>
          <span>
            {inventorySummary.componentCount} components · {inventorySummary.versionCount} versions
          </span>
        </div>
        <p className="inventory-catalog__note">
          This read-only management view tracks identity, ownership, review evidence and exact
          usage. Existing POC usage is recorded, but new adoption remains blocked until a version
          reaches approved status.
        </p>
        <dl className="inventory-summary" aria-label="Thread inventory status summary">
          <div>
            <dt>In review</dt>
            <dd>{inventorySummary.reviewVersionCount}</dd>
          </div>
          <div>
            <dt>Approved</dt>
            <dd>{inventorySummary.approvedVersionCount}</dd>
          </div>
          <div>
            <dt>Figma mapped</dt>
            <dd>{inventorySummary.figmaMappedVersionCount}</dd>
          </div>
        </dl>
        <div className="inventory-grid">
          {inventoryRows.map((row) => (
            <article
              className="inventory-card"
              data-thread-object-id={row.objectId}
              key={`${row.objectId}@${row.version}`}
            >
              <header className="inventory-card__header">
                <div>
                  <span className="eyebrow">{row.category}</span>
                  <h4>{row.name}</h4>
                </div>
                <div className="inventory-card__badges">
                  <Badge tone={row.status === 'approved' ? 'success' : 'warning'}>
                    {row.status}
                  </Badge>
                  <Badge tone={row.adoptionState === 'available' ? 'success' : 'warning'}>
                    New adoption {row.adoptionState}
                  </Badge>
                </div>
              </header>
              <code className="inventory-card__identity">{row.objectId}</code>
              <p>{row.description}</p>
              <dl className="inventory-card__metadata">
                <div>
                  <dt>Version</dt>
                  <dd>{row.version}</dd>
                </div>
                <div>
                  <dt>Owner</dt>
                  <dd>{row.ownerTeam}</dd>
                </div>
                <div>
                  <dt>Issue label</dt>
                  <dd>
                    <code>{row.issueLabel}</code>
                  </dd>
                </div>
                <div>
                  <dt>Code</dt>
                  <dd>
                    <code>
                      {row.packageName}#{row.exportName}
                    </code>
                  </dd>
                </div>
                <div>
                  <dt>Figma</dt>
                  <dd>{row.figma.status}</dd>
                </div>
                <div>
                  <dt>Used by</dt>
                  <dd>
                    {row.appIds.length
                      ? row.appIds.map((appId) => appNames.get(appId) ?? appId).join(', ')
                      : 'No available application'}
                  </dd>
                </div>
              </dl>
              <div className="inventory-quality" aria-label={`${row.name} quality gates`}>
                {Object.entries(row.quality).map(([gate, result]) => (
                  <span key={gate}>
                    {qualityGateLabels[gate as keyof typeof qualityGateLabels]}
                    <Badge tone={result === 'passed' ? 'success' : 'neutral'}>{result}</Badge>
                  </span>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="discovery-map" aria-labelledby="discovery-map-heading">
        <div className="implementation-map__section-heading">
          <div>
            <span className="eyebrow">THREAD INVENTORY · PHASE 7</span>
            <h3 id="discovery-map-heading">Inventory-first component discovery</h3>
          </div>
          <Badge tone="success">Live deterministic adapter</Badge>
        </div>
        <p className="discovery-map__note">
          Figma, agents and application teams must search governed inventory before opening work.
          Matching is explainable metadata evaluation—not an invented semantic or Figma claim.
        </p>
        <ol className="discovery-map__steps" aria-label="Inventory-first discovery decisions">
          <li>
            <span>1</span>
            <div>
              <strong>Search approved inventory</strong>
              <p>Exact identity and export matches are checked before related metadata.</p>
            </div>
          </li>
          <li>
            <span>2</span>
            <div>
              <strong>Reuse or review alternatives</strong>
              <p>Only an approved exact version is reusable; blocked and related records stop.</p>
            </div>
          </li>
          <li>
            <span>3</span>
            <div>
              <strong>Request only a genuine gap</strong>
              <p>A trusted workflow actor may open one traceable, duplicate-protected request.</p>
            </div>
          </li>
        </ol>
        <div className="discovery-map__proof">
          <div>
            <span className="eyebrow">LIVE NON-PERSISTING PROBE</span>
            <strong>Button lookup</strong>
            <p>{discoveryProbe.explanation}</p>
          </div>
          <dl>
            <div>
              <dt>Decision</dt>
              <dd>{discoveryProbe.decision}</dd>
            </div>
            <div>
              <dt>Match</dt>
              <dd>
                {discoveryProbe.exactMatch?.reference.objectId}@
                {discoveryProbe.exactMatch?.reference.version}
              </dd>
            </div>
            <div>
              <dt>Adoption</dt>
              <dd>{discoveryProbe.exactMatch?.adoptionState}</dd>
            </div>
            <div>
              <dt>Request created</dt>
              <dd>{discoveryProbe.canOpenRequest ? 'eligible after authorization' : 'no'}</dd>
            </div>
          </dl>
        </div>
        <div className="discovery-map__api" aria-label="Thread discovery API routes">
          <code>POST /api/thread/v1/discovery</code>
          <span>Read-only preview for an application session</span>
          <code>POST /api/thread/v1/discovery/request</code>
          <span>Workflow identity required; creates only after an inventory gap</span>
        </div>
        <p className="discovery-map__truth">
          Current catalog: {inventorySummary.approvedVersionCount} approved for reuse ·{' '}
          {inventorySummary.reviewVersionCount} present but blocked in review.
        </p>
      </section>

      <section className="thread-workbench" aria-labelledby="thread-workbench-heading">
        <div className="implementation-map__section-heading">
          <div>
            <span className="eyebrow">THREAD ORCHESTRATION · PHASE 8</span>
            <h3 id="thread-workbench-heading">Agent build jobs and role-aware workbench</h3>
          </div>
          <Badge tone="success">Protected API implemented</Badge>
        </div>
        <p className="thread-workbench__note">
          A genuine inventory gap can now become one durable build job. The job records who claimed
          it, the candidate binding and test evidence. Generated source is never executed by this
          POC; it remains inert until an authorized actor explicitly attaches it to the request.
        </p>
        <dl className="thread-workbench__status" aria-label="Current build workbench boundary">
          <div>
            <dt>Current browser</dt>
            <dd>Application identity</dd>
          </div>
          <div>
            <dt>Workflow records</dt>
            <dd>Protected from this session</dd>
          </div>
          <div>
            <dt>Generated code</dt>
            <dd>Execution disabled</dd>
          </div>
        </dl>
        <ol className="thread-workbench__stages" aria-label="Thread build-job lifecycle">
          {buildJobStages.map((stage, index) => (
            <li key={stage.status}>
              <span className="thread-workbench__number" aria-hidden="true">
                {index + 1}
              </span>
              <div>
                <span className="eyebrow">{stage.status}</span>
                <h4>{stage.title}</h4>
                <p>{stage.description}</p>
              </div>
              {index < buildJobStages.length - 1 && (
                <span className="thread-workbench__arrow" aria-hidden="true">
                  →
                </span>
              )}
            </li>
          ))}
        </ol>
        <div className="thread-workbench__boundary">
          <div>
            <span className="eyebrow">ROLE-AWARE PROJECTION</span>
            <strong>Each actor sees only valid next actions</strong>
            <p>
              Agent/engineer: create, claim and submit · Claiming role: stage artifact · Engineer:
              verify artifact · Designer/engineer: review or return · Governance: approve only after
              every gate passes
            </p>
          </div>
          <div className="thread-workbench__api" aria-label="Thread workbench API routes">
            <code>GET /api/thread/v1/workbench</code>
            <code>GET /api/thread/v1/build-jobs</code>
            <code>POST /api/thread/v1/build-jobs/:jobId/claim</code>
            <code>POST /api/thread/v1/build-jobs/:jobId/submit</code>
            <code>POST /api/thread/v1/build-jobs/:jobId/attach</code>
          </div>
        </div>
        <p className="thread-workbench__truth">
          Implemented now: durable records, strict state transitions, source validation, optimistic
          concurrency and retry-safe attachment. Not claimed: a live Figma connector, agent
          invocation, package publication or generated-code execution.
        </p>
      </section>

      <section className="artifact-quarantine" aria-labelledby="artifact-quarantine-heading">
        <div className="implementation-map__section-heading">
          <div>
            <span className="eyebrow">THREAD ARTIFACTS · PHASE 9</span>
            <h3 id="artifact-quarantine-heading">Candidate artifact quarantine</h3>
          </div>
          <Badge tone="success">Verified artifact required</Badge>
        </div>
        <p className="artifact-quarantine__note">
          Candidate metadata cannot attach directly through Bobbin. The claiming build role first
          stages an immutable manifest. An engineer then records all policy evidence, and only an
          all-pass artifact unlocks the existing attachment operation.
        </p>
        <ol className="artifact-quarantine__stages" aria-label="Thread artifact staging flow">
          {artifactStages.map((stage, index) => (
            <li key={stage.title}>
              <span aria-hidden="true">{index + 1}</span>
              <div>
                <strong>{stage.title}</strong>
                <p>{stage.description}</p>
              </div>
            </li>
          ))}
        </ol>
        <div className="artifact-quarantine__evidence">
          <div>
            <span className="eyebrow">ENGINEER POLICY GATES</span>
            <ul>
              <li>Provenance evidence</li>
              <li>Dependency-audit evidence</li>
              <li>License-review evidence</li>
            </ul>
          </div>
          <div className="artifact-quarantine__identity">
            <span className="eyebrow">IMMUTABLE IDENTITY</span>
            <code>package + version + export + source path</code>
            <code>SHA-256 + size + application/gzip</code>
            <code>build log + SBOM references</code>
          </div>
          <div className="artifact-quarantine__api" aria-label="Thread artifact API routes">
            <code>GET /api/thread/v1/artifacts</code>
            <code>POST /api/thread/v1/build-jobs/:jobId/artifacts</code>
            <code>POST /api/thread/v1/artifacts/:artifactId/verify</code>
          </div>
        </div>
        <p className="artifact-quarantine__truth">
          Current runtime: 0 artifact manifests. The quarantine API accepts manifest and evidence
          metadata only. Phase 10 computes content identity before the manifest arrives here;
          neither boundary executes source, installs dependencies or publishes packages.
        </p>
      </section>

      <section className="adapter-pipeline" aria-labelledby="adapter-pipeline-heading">
        <div className="implementation-map__section-heading">
          <div>
            <span className="eyebrow">CONTROLLED ADAPTERS · PHASE 10</span>
            <h3 id="adapter-pipeline-heading">Figma-to-quarantine pipeline</h3>
          </div>
          <Badge tone="success">Deterministic mocks implemented</Badge>
        </div>
        <p className="adapter-pipeline__note">
          Replaceable server-side contracts now connect a design source, inventory discovery, a
          component builder and artifact inspection. The production connector can change later
          without changing the governed request, build-job or artifact records.
        </p>
        <ol className="adapter-pipeline__stages" aria-label="Controlled adapter pipeline">
          {automationStages.map((stage, index) => (
            <li key={stage.title}>
              <span aria-hidden="true">{index + 1}</span>
              <div>
                <strong>{stage.title}</strong>
                <p>{stage.description}</p>
              </div>
            </li>
          ))}
        </ol>
        <div className="adapter-pipeline__boundary">
          <div>
            <span className="eyebrow">BROWSER INPUT ALLOWLIST</span>
            <strong>Accepted</strong>
            <code>runId + fixtureId</code>
            <strong>Rejected</strong>
            <p>Figma URL · access token · free-form prompt · command · package bytes</p>
          </div>
          <div>
            <span className="eyebrow">REPLACEABLE SERVER CONTRACTS</span>
            <code>ThreadDesignSourceAdapter</code>
            <code>ThreadComponentBuilderAdapter</code>
            <code>ThreadArtifactInspectorAdapter</code>
          </div>
          <div>
            <span className="eyebrow">CORRELATED RUN RECORD</span>
            <code>GET /api/thread/v1/automation/runs</code>
            <code>POST /api/thread/v1/automation/runs</code>
            <p>Adapter versions · decision · request/job/artifact IDs · bounded failure</p>
          </div>
        </div>
        <p className="adapter-pipeline__truth">
          Current runtime: 0 adapter runs. The mock proves both outcomes: inventory coverage stops
          generation, while a genuine gap produces a server-hashed staged artifact. It does not call
          the external Figma API, execute generated code, run npm or replace engineer verification.
        </p>
      </section>

      <section className="release-promotion" aria-labelledby="release-promotion-heading">
        <div className="implementation-map__section-heading">
          <div>
            <span className="eyebrow">INVENTORY RELEASE · PHASE 11</span>
            <h3 id="release-promotion-heading">Verified promotion, reuse and rollback</h3>
          </div>
          <Badge tone="success">Final POC lifecycle implemented</Badge>
        </div>
        <p className="release-promotion__note">
          A candidate reaches inventory only when its human-approved component, attached build job
          and verified artifact form one exact evidence chain. The released snapshot immediately
          participates in ordinary inventory discovery for later applications.
        </p>
        <ol className="release-promotion__stages" aria-label="Thread release lifecycle">
          {releaseStages.map((stage, index) => (
            <li key={stage.title}>
              <span aria-hidden="true">{index + 1}</span>
              <div>
                <strong>{stage.title}</strong>
                <p>{stage.description}</p>
              </div>
            </li>
          ))}
        </ol>
        <div className="release-promotion__boundary">
          <div>
            <span className="eyebrow">GOVERNANCE ACTIONS</span>
            <code>promote-release</code>
            <code>rollback-release</code>
            <p>The workbench exposes only the valid action for the current release state.</p>
          </div>
          <div>
            <span className="eyebrow">RUNTIME CATALOG</span>
            <code>GET /api/thread/v1/inventory</code>
            <code>POST /api/thread/v1/discovery</code>
            <p>Active releases return reuse; rolled-back versions remain visible but blocked.</p>
          </div>
          <div>
            <span className="eyebrow">RELEASE AUDIT API</span>
            <code>GET /api/thread/v1/releases</code>
            <code>POST /api/thread/v1/requests/:requestId/releases</code>
            <code>POST /api/thread/v1/releases/:releaseId/rollback</code>
          </div>
        </div>
        <p className="release-promotion__truth">
          Current runtime: 0 release records. Rollback never deletes the request, job, artifact or
          release; it records governance evidence and deprecates the released version. Package
          signing, registry publication and multi-region rollout remain production controls.
        </p>
      </section>

      <section className="candidate-pipeline" aria-labelledby="candidate-pipeline-heading">
        <div className="implementation-map__section-heading">
          <div>
            <span className="eyebrow">AGENTIC PIPELINE FOUNDATION</span>
            <h3 id="candidate-pipeline-heading">Request, build, review, then register</h3>
          </div>
          <Badge>0 active requests</Badge>
        </div>
        <p className="candidate-pipeline__note">
          The workflow is now available behind capability-protected Bobbin APIs and a durable local
          mock repository. This POC has not invented an enterprise Figma mapping. The controlled
          Phase 10 adapter may create typed requests; it cannot approve or promote components.
        </p>
        <div className="candidate-pipeline__api" aria-label="Thread workflow API boundary">
          <div>
            <Badge tone="success">Capability protected</Badge>
            <strong>Bobbin derives the workflow actor from trusted server configuration</strong>
          </div>
          <code>GET /api/thread/v1/inventory</code>
          <code>/api/thread/v1/requests</code>
          <span>
            File-backed mock repository · validated records · atomic replacement · optimistic
            concurrency
          </span>
          <small>
            The current application session can read inventory only. Request access requires a
            separately authenticated Thread workflow identity.
          </small>
        </div>
        <ol className="candidate-pipeline__stages" aria-label="Thread candidate lifecycle">
          {candidatePipelineStages.map((stage, index) => (
            <li key={stage.status}>
              <span className="candidate-pipeline__number" aria-hidden="true">
                {index + 1}
              </span>
              <div>
                <span className="eyebrow">{stage.status}</span>
                <h4>{stage.title}</h4>
                <strong>{stage.actor}</strong>
                <p>{stage.description}</p>
              </div>
              {index < candidatePipelineStages.length - 1 && (
                <span className="candidate-pipeline__arrow" aria-hidden="true">
                  →
                </span>
              )}
            </li>
          ))}
        </ol>
        <div className="candidate-pipeline__permissions">
          <strong>Enforced boundary</strong>
          <span>Agent: request · build · test · submit</span>
          <span>Designer/engineer: formal review evidence · return for rework</span>
          <span>Governance: approve · produce inventory-ready record</span>
        </div>
      </section>

      {visibleAudit.length > 0 && (
        <section className="reuse-audit" aria-labelledby="reuse-audit-heading">
          <div className="implementation-map__section-heading">
            <div>
              <span className="eyebrow">REUSE AUDIT · INTEGRATED</span>
              <h3 id="reuse-audit-heading">Shared patterns recovered from these two apps</h3>
            </div>
            <span>{visibleAudit.length} duplicated patterns moved into Thread</span>
          </div>
          <p className="reuse-audit__note">
            These are working components used by both current app modules—not proposed future
            workflows. The usage descriptions below point to their real locations.
          </p>
          <div
            className="thread-table-scroll"
            role="region"
            aria-label="Integrated reuse audit"
            tabIndex={0}
          >
            <table className="thread-table audit-table">
              <thead>
                <tr>
                  <th scope="col">Thread component</th>
                  <th scope="col">Transaction History</th>
                  <th scope="col">Associate Communications</th>
                  <th scope="col">Outcome</th>
                </tr>
              </thead>
              <tbody>
                {visibleAudit.map((row) => (
                  <tr data-audit-component={row.component} key={row.component}>
                    <th scope="row">
                      <code>{row.component}</code>
                    </th>
                    <td>{row.transactionUse}</td>
                    <td>{row.communicationsUse}</td>
                    <td>
                      <Badge tone="success">Integrated once</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <footer className="implementation-map__boundary">
        <strong>Deliberately app-specific:</strong> journey composition, transaction/document
        adapters and legacy business rules. Production data access will use approved Apigee APIs.
        Whether Bobbin or an Enterprise Architecture service owns authentication, sessions and
        proxying remains an explicit decision point.
      </footer>
    </section>
  );
}
