# Overlock — two-application modernization POC

A local React/TypeScript proof of concept based on the supplied Transaction
History and Associate Communications source. This is a new implementation;
the originals and original-JSP previews are not modified.

**All identities, transactions and documents are synthetic.** Local profile
selection is not enterprise authentication. No Oracle, ForgeRock, Apigee,
payment, email, POS or enterprise network integration is enabled.

## Run locally

Use Node.js 24 LTS and npm. From this directory:

```powershell
npm.cmd ci --offline=false --cache .npm-cache
npm.cmd run check
npm.cmd run start:topology
```

Open <http://127.0.0.1:4300/>. The recommended topology starts five loopback HTTP services:

- OneX Hub with the Bobbin fallback boundary: port 4300
- GCP Storage-shaped MFE asset host: port 4310
- Shared session, Apigee mock and synthetic legacy backend: ports 4340–4360

The Hub is the only UI runtime. It lazy-loads Transaction History and Associate Communications
as static micro-frontend bundles from port 4310. Stop with Ctrl+C. `npm start` remains the compact
same-origin Bobbin fallback on ports 4300/4301.
`npm run dev` watches server changes, but does not hot-rebuild browser assets.
After UI changes, run `npm run build`, restart the server, then reload the page.
The build and test tools spawn local Node/esbuild workers; sandboxed environments
may need permission to run them.

For the equivalent five-container simulation, start Docker Desktop and run
`docker compose up --build`. Hub is published at port 4300 and the MFE asset host at 4310. See
[`LOCAL-TOPOLOGY.md`](LOCAL-TOPOLOGY.md) for the flow, service table and verification commands.

## Code ownership

| Location                                | Responsibility                                                                     |
| --------------------------------------- | ---------------------------------------------------------------------------------- |
| `platform/thread`                       | Shared React components plus the governed inventory contract                       |
| `platform/spool`                        | Reviewed manifests, route registration and lazy application loading                |
| `platform/binder`                       | Typed data-load contracts, browser clients, server routes and legacy/mock adapters |
| `platform/bobbin`                       | OneX Hub shell plus fallback session/API boundary                                  |
| `platform/simulation`                   | MFE storage, shared-session, Apigee and local/container topology                   |
| `platform/contracts`                    | Cross-platform browser DTOs and manifest contracts                                 |
| `platform/management`                   | In-product architecture and reuse evidence                                         |
| `applications/transaction-history`      | Transaction History journey and single-spa entry                                   |
| `applications/associate-communications` | Communications web/POS presentations and single-spa entry                          |
| `tests`                                 | Automated phase-gate checks                                                        |
| `PLAN.md`                               | Phase status, acceptance evidence and limitations                                  |

Thread is a workspace library in this POC, not yet a published npm package.
Internal versioned package publication and template distribution are later work.
The application entry modules are separately emitted by one build; independently
versioned deployment pipelines are not implemented here.

### Thread inventory · Phases 1–12

`platform/thread/inventory` now defines the inventory identity, version and
governance contract. Component object IDs use a stable form such as
`thread.component.data-table`; implementations use semantic versions. Each
version records its code binding, optional Figma identifiers, owner, lifecycle
state and tests/accessibility/design/security results.

The enforced lifecycle is `requested → candidate → review → approved →
deprecated → retired`. Agents may create candidates and submit them for review,
but cannot approve, deprecate or retire inventory versions. Governance approval
requires every quality gate to pass.

Phase 2 registered all twelve React components actually exported by Thread with
stable object IDs and baseline version `1.0.0`. The imported versions remain in
`review`: automated tests pass, while formal accessibility, design and security
reviews and Figma mappings remain pending. The `money` export is a helper rather
than a component. App-specific `Receipt` and `DocumentViewer` implementations
are explicitly excluded because reuse has not been demonstrated.

Phase 3 migrated every Spool manifest to exact `{ objectId, version }` Thread
references and records app-local components separately. Manifest validation
rejects malformed, unknown, duplicated or unavailable versions. These references
document the two existing POC applications against the `review` baseline; they
do not permit new adoption until the referenced version is approved.

Phase 4 adds a read-only management inventory to **See how it works**. It shows
every component/version's object ID, category, owner, issue label, code binding,
lifecycle state, quality gates, Figma status and usage derived from the manifests
visible to the current session. It explicitly marks the review baseline as
blocked for new adoption.

Phase 5 implements the governed missing-component workflow under
`platform/thread/pipeline`: `requested → candidate → review → approved`. Agents
may request, build, record automated test evidence and submit candidates. Formal
review evidence is role-bound, and only governance can approve an item after all
four gates pass. Approval returns a validated inventory-ready record; it does not
silently mutate the registry, execute generated code or claim a live Figma link.

Phase 6 exposes that workflow through capability-protected Bobbin endpoints at
`/api/thread/v1`. All application sessions can read the validated inventory.
Listing or changing requests requires a Thread workflow identity supplied by
trusted server configuration, and only governance receives approval capability;
the JSON body cannot select its actor or role. The default browser profiles remain
application identities and therefore cannot inspect or mutate workflow requests.

The local runtime persists requests in `runtime/thread-requests.json`. Every read
revalidates the complete envelope and every write uses an exact-file temporary
replacement, backup recovery and optimistic timestamp check. Repository damage
fails closed. This is a durable single-process mock repository, not a production
multi-node database or enterprise authentication integration. Approval still
produces an inventory-ready record without silently changing the static registry.

Phase 7 adds inventory-first discovery under `platform/thread/discovery`. A typed
potential request is evaluated before workflow creation. An exact approved current
version returns `reuse`; an exact blocked record or sufficiently related metadata
returns `review-alternatives`; only a real `inventory-gap` may open a request.
Matching is deterministic and reports the identity, name, description and category
signals used—it is not presented as AI semantic certainty.

Application sessions may preview discovery through
`POST /api/thread/v1/discovery`. The guarded
`POST /api/thread/v1/discovery/request` route requires a configured workflow actor,
stops on reusable or reviewable inventory, and rejects an existing object or the
same source requirement. Validated application/Figma source IDs remain attached
to the result for traceability. No live Figma connection or mapping was invented.
The management view demonstrates an actual Button lookup: the component is found,
but its review version correctly remains blocked and no request is created.

Phase 8 adds the controlled orchestration layer under `platform/thread/jobs`.
Every genuine inventory-gap request can have at most one durable build job with
the lifecycle `queued → running → candidate-ready → attached`. Agent and engineer
roles may claim work and submit a validated React code binding plus test evidence.
That output is stored as inert metadata: the POC never imports or executes it.
Only an explicit attach operation copies the exact candidate and evidence into
the existing governed request workflow.

Build jobs persist separately in `runtime/thread-build-jobs.json` with the same
bounded, validated, atomic-replacement and optimistic-concurrency properties as
requests. Attachment is retry-safe if the request commits before the job record.
Protected workbench and build-job APIs derive the actor from trusted server
configuration and project only valid next actions for that role and state. The
application browser remains unable to inspect workflow records. No live agent,
Figma connector, package publication or generated-code execution is claimed.

Phase 9 adds artifact-manifest quarantine under `platform/thread/artifacts`.
Candidate-ready job metadata can no longer attach through Bobbin until the
claiming build role stages an immutable manifest and an engineer records all
required policy evidence. Each manifest derives its package/version/export/source
binding from the exact job candidate and records a SHA-256 identity, bounded
archive size, `application/gzip` media type, build-log reference and SBOM
reference. Provenance, dependency-audit and license-review gates must all pass.

Rejected attempts remain durable audit history and allow a new manifest; a
verified manifest freezes its content identity and prevents another active
artifact for the job. Build-job attachment now requires that verified record.
Artifacts persist separately in `runtime/thread-artifacts.json`, and the
role-aware workbench projects stage, verify or attach actions from the combined
request/job/artifact state. The quarantine route stores manifests only and does
not accept archive bytes.

Phase 10 adds controlled adapter orchestration under
`platform/thread/automation`. A replaceable design-source contract resolves an
allow-listed mock Figma fixture, then the existing deterministic discovery layer
runs first. An inventory match stops the pipeline; a genuine gap creates the
governed request and claimed build job before a static reviewed template produces
inert source metadata.

The server-side inspection adapter compresses that bounded source in memory,
computes its SHA-256 and byte size, and stages the resulting Phase 9 manifest.
Archive bytes are discarded and generated source is never executed, installed or
published. Human engineer verification remains a separate required step.

Every attempt is recorded in `runtime/thread-adapter-runs.json` with a correlation
ID, exact adapter versions, inventory decision, request/job/artifact chain and a
bounded failure. The browser API accepts only `runId` and one of two reviewed
fixture IDs; Figma URLs, credentials, free-form prompts, commands and package
bytes are rejected. The adapters are deterministic POC implementations, not a
live Figma connection, generative agent or enterprise scanner.

Phase 11 completes the local lifecycle under `platform/thread/releases`.
Governance can promote only an approved request backed by its exact attached
build job and verified artifact. The release stores an immutable source chain,
the artifact digest and a validated component snapshot, then adds that approved
version to the runtime inventory catalog used by both the inventory endpoint and
discovery. A later application therefore receives `reuse` for the released
object ID and version rather than creating a duplicate request.

Rollback preserves the release and evidence chain, records its reason and
evidence reference, and changes the released snapshot from `approved` to
`deprecated`. Discovery then returns `review-alternatives`, blocking new
adoption without deleting audit history. The workbench derives `promote-release`
and `rollback-release` actions only for governance and the applicable state.
Runtime release records persist in `runtime/thread-releases.json`.

Phase 12 now follows the latest client direction under `platform/simulation`. One OneX Hub
single-spa root config dynamically loads independently built MFE bundles from a separate static
asset service shaped like GCP Storage. The Hub uses one shared synthetic session service, while
typed POC API adapters traverse an Apigee mock before reaching the synthetic backend.
`compose.yaml` runs the same five boundaries as containers; `npm run start:topology` runs them as
loopback HTTP services when Docker is unavailable.

## Runtime and security boundary

The shell retrieves reviewed manifests from the Hub boundary. The single-spa root config loads the
selected application entry from the static MFE asset origin and mounts it into the same workspace.
There are no TH or AC UI containers. Both apps import shared Thread chunks. Components receive
typed data and callbacks, not legacy URLs. A typed POC adapter owns data loading separately from UI
composition. Its first explicit pilot
is the Associate Communications POS menu, loaded from
`/api/binder/v1/apps/associate-communications/menu` with typed validation and the
current synthetic store context.

Manifests drive application registration, declare launch mode, and drive query modes/fields and
named API bindings. Page composition and domain behavior remain reviewed React
code. This is not a universal JSON workflow renderer or an automatic converter
for the other 268 applications.

`launchMode` records intended production integration. It does not implement a
distinct production login policy: both demo paths receive a local synthetic
session. The restricted profile demonstrates server-side capability checks;
it is not a ForgeRock login flow or a trusted register-launch implementation.

Browser requests use same-origin `/api` paths. Bobbin currently protects the Hub/session boundary
as a fallback until Enterprise Architecture proves its replacement. POC adapters use
server-configured, allowlisted upstream origins and exact
reviewed operations. Manifests cannot
introduce arbitrary module URLs, proxy destinations or executable expressions.
Errors include a request ID; backend failures differ from successful empty results.

The synthetic legacy service, Apigee mock, shared session, MFE storage and one Hub runtime are
separate HTTP listeners in process mode and separate services in Compose. Contract tests launch
them on ephemeral loopback ports and exercise the Hub/API adapter → Apigee → backend path.
The mock endpoint can later be replaced by
an approved integration adapter, but replacing a URL alone will not migrate
business logic currently embedded in Java actions, sessions and stored procedures.

Production identity, CSRF/session lifecycle policy, AD groups, approved UX assets,
API contracts, Apigee configuration, observability, deployment and security
approval remain required for a production system.

Other full-SOW work not delivered by this two-app POC includes Finish Line,
Vue parity, approved Ark UI adapters/component cohort, Storybook, Code Connect
and MCP context/tooling, three packaged Spool templates, RoadRunners Bobbin
handover, and enterprise CI/CD/GKE delivery. The POC does not establish complete
workflow parity or production acceptance for either supplied legacy app.

## Demo guide

Use the default synthetic associate profile for both applications.

### Platform implementation map

On the application hub, choose **See how it works** beside the application count.
The expandable map uses the manifests returned by Bobbin to show each app's
reviewed route, bundle, launch mode, capability and named operations. Its Thread
matrix distinguishes components reused by both apps from Thread components used
by one app. Each manifest card shows the exact inventory IDs/versions and lists
application-local components separately.
The map also lists the five local runtime services. It shows Thread and Spool at build time, the
separate MFE asset origin, the OneX Hub root config and Bobbin's temporary fallback responsibility.
It also labels Binder as an internal POC adapter rather than a confirmed client platform product.

The same map includes a cross-app reuse audit. It identifies four patterns that
were duplicated in the two current implementations—`ContextBar`, `RequestError`,
`ResultsSummary` and `BackButton`—and shows their real usage after moving them
into the shared Thread package. It does not list hypothetical future workflows.

### Web and POS presentations

Use the **Web view / POS view** switch in the header, or open Associate
Communications directly in [POS view](http://127.0.0.1:4300/apps/associate-communications?view=pos).
This is one app and one set of API contracts with two presentations, not two
backends. The URL's `view` preference is per tab, survives reload and is retained
by application/hub links; it does not grant capabilities or change store identity.
The hub and Transaction History also use the alternate POS-style shell, but
only Associate Communications has the category menu and T-key command rail.

Associate Communications' POS presentation reproduces the legacy menu/key-rail
interaction pattern using the modern theme. Its eight base menu items are loaded
from the mock Binder API rather than embedded in the React presentation. Training
Alerts opens the existing
list/detail/page journey. Other legacy categories are visibly unavailable in
this two-app POC. The browser uses **Alt+1 through Alt+8** for enabled T-key
actions, while ignoring editable fields; these are preview shortcuts, not native
register key bindings. Exit to POS leads to a clearly labelled simulated menu.
Barcode printing remains disabled: there is no printer bridge or real register.

For actual delivery, a compatible POS webview can request reviewed JS/CSS/images
from centrally hosted Bobbin, rather than requiring a bespoke native UI install
for each application. This POC still binds only to this computer's loopback ports.
It does not enable remote register access, offline caching, automatic updating,
enterprise distribution or compatibility with old POS browser engines. Those
require a separate approved deployment/host integration. Browser theme assets
remain local to the served build; no third-party theme CDN was introduced.

### Transaction History

Keep the default 2026-11-01 through 2026-11-14 date range.

| UPC            | Expected outcome                                        |
| -------------- | ------------------------------------------------------- |
| `000123456789` | Four transactions across two stores, including a return |
| `000999888777` | One transaction; automatically opens details            |
| `111111111111` | Successful empty result                                 |
| `000000000250` | 251 matches, first 250 displayed with a warning         |

Select a result, inspect Summary/History, then view either synthetic receipt.
Use **UPC, store & date** to filter the default UPC to two records per store.
Back returns to the current mode's saved results. Separate tabs keep separate
search state. Invalid/reversed dates produce explicit validation errors.

### Associate Communications

Open the app from the hub or directly at
<http://127.0.0.1:4300/apps/associate-communications>.

- Holiday floor readiness (`ac-101`): two pages, Apparel, New flag.
- A thoughtful handoff (`ac-102`): one page, Home, no end date, all-store scope.
- Beauty FOB: genuine empty result.
- Eligibility is fixed as of 2026-11-14. Expired, future, other-store and
  cross-division fixtures are excluded and direct access is denied.

The viewer offers **Fit width** and **Actual size**. At actual size, the labelled
viewing area can be scrolled horizontally with keyboard arrow keys or a pointer.

The footer's restricted profile removes TH from the hub and denies its APIs,
while leaving AC available. Profile changes are isolated by browser session,
not by individual tab; query state remains per tab.

See SOURCE-MAPPING.md for preserved behavior and deliberate differences, and
REUSE-EVIDENCE.json for the Phase 4 before/after source/build hashes. Later
Phase 5 accessibility changes intentionally follow that captured experiment.

## Theme reference

The theme was updated from the live [Macy's website](https://www.macys.com/).
Its main content was access-restricted during inspection, but the public header
and footer rendered. Those surfaces showed black sans-serif navigation, white
backgrounds, neutral dividers, a dark footer and the red-star/black-wordmark logo.
The observed navigation font stack started with proprietary `Macys Sans`;
this POC uses `Helvetica Neue`, Helvetica and Arial fallbacks, without copying
or remotely loading Macy's font files.

`public/brand/macys-logo.svg` is the unchanged public logo retrieved from the
[asset URL used by that header](https://assets.macysassets.com/nuxt-app/navigation-wgl/static/public/images/mcom/logo.svg).
It is served locally, with no third-party image or font requests at runtime.
Macy's owns its marks; local POC use does not establish production brand approval.
The logo's `#E11A2B` red is decorative. Smaller red text uses the darker
`#C8102E`, primary actions use black/white, and existing semantic status colors
remain distinct. This is an associate-workspace adaptation, not a copy of the
retail storefront or an approved internal design-system specification.

## Accessibility boundaries

The POC includes keyboard-operable controls, feedback announcements, labelled
forms, bounded viewer navigation and responsive layouts. It has not undergone
a full WCAG audit. Page images expose a descriptive title/page alternative,
not accessible document-body text. Production document APIs need an accessible
text or equivalent document format in addition to images.

## Scaling beyond the two-app POC

The separation is suitable for many applications, but production scale must use
a governed application catalog rather than allowing arbitrary runtime JavaScript
URLs. Each app version should publish a reviewed manifest and independently
deployable bundle; Spool should fetch only the capability-filtered catalog page
and lazy-load the selected app. Artifact signatures/integrity, CSP, compatibility
rules, deployment rollout and observability are required before remote bundles
are accepted. Phase 11 proves catalog promotion and audit-preserving component
rollback; it does not deploy packages or roll back live application traffic.
Binder contracts should be versioned independently and route through approved
Apigee products/adapters. Phase 12 proves the proposed boundaries locally, but its in-memory shared
session mock is not an HA production store. App-specific business rules remain inside the
application and Binder adapter, not in the shared shell or Thread library.

This means adding 270 catalog records does not mean mounting 270 applications at
once. The current POC proves route-based loading and separate service ownership for two compiled
entries. The images still use one source/build context; minimal independently versioned app
artifacts, external catalog distribution and production orchestration are the next scale gates.

## Phase gates

All five original local POC gates and the subsequent presentation,
implementation-map, Binder and Thread-inventory follow-ups passed. The latest
gate includes 190 automated unit/integration/review/theme/presentation/topology tests and
six compiled-artifact checks (196 total), plus the TypeScript/Vite production
build.
See PLAN.md for per-phase evidence and browser verification.
This does not represent production readiness or full-SOW acceptance.
