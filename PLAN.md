# Overlock two-application POC

Original application directories and the original-JSP preview remain untouched.
All identities, transactions and documents in this implementation are synthetic.
This is not production authentication, Apigee, Oracle, a payment integration or a POS bridge.

## Phase gates

Progress only after the phase's automated checks pass. Browser acceptance is
also required for completed user journeys. Record evidence and limitations here.

| Phase                         | Scope                                                                                                                | Gate                                                                                                                                       | Status |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| 1 — Foundation                | Shared contracts, Thread primitives, validated Spool manifests, Bobbin, separate HTTP mock upstream and hub skeleton | Typecheck/build; health/bootstrap; manifest and operation allowlists; same-origin routing; normalized upstream errors                      | Passed |
| 2 — Transaction History       | UPC/date search, result selection, details, history, synthetic receipt                                               | Matching/empty/invalid queries; details/receipt consistency; division authorization; 250-row cap; independent query state; browser journey | Passed |
| 3 — Associate Communications  | Training Alerts, metadata, multipage viewer, direct URL                                                              | Eligibility/filtering; empty/error/denied/missing records; page authorization; list restoration; browser journey                           | Passed |
| 4 — Dynamic loading and reuse | single-spa registration, separately emitted app entry bundles, hub launch, approved manifest-driven search variation | Only selected app entry loads; AC direct launch; UPC/store/date added without Thread/shell changes; real HTTP upstream binding swap        | Passed |
| 5 — Hardening and handoff     | Regression, keyboard/accessibility review, failure cases, startup/docs, screenshots                                  | Full suite and production build; smoke against running build; browser checks; documented boundaries                                        | Passed |

## Design boundaries

- Thread owns generic interaction components, not transaction or document policy.
- Spool owns reviewed configuration, module registration and starter/runtime conventions.
- Application modules own domain-specific screens and small explicit adapters.
- Bobbin serves built assets and exposes only allowlisted same-origin operations.
- Upstream addresses remain server-side. Browser manifests cannot choose arbitrary servers.
- The mock upstream is a separate HTTP service; it is not called Apigee.
- Production API mapping depends on Macy's supplied API/Apigee contracts. Replacing a URL alone is not guaranteed to integrate JSP/Java behavior.
- Local profile selection demonstrates capability enforcement, not secure enterprise identity.
- The POC uses React; Vue parity, full template distribution and production deployment remain subsequent SOW work.

## Evidence

- Phase 1: `npm run check` — 24/24 tests passed, TypeScript + Vite production build passed. Browser verified hub and actual single-spa mount of the separately emitted TH entry. Build preserves lifecycle exports and emits shared React/Thread/Spool chunks. Corrected schema coercion, mutable approval aliasing and malformed upstream JSON normalization during the gate. UI is provisional, not approved Macy's UX.
- Phase 2: `npm run check` — 48/48 tests passed and production build passed. Browser verified four-result search, transaction 70001 detail/history, DCR and electronic receipt totals, restored results on back, single-result auto-open (71001) and genuine empty results. Independent review validated exact-cent arithmetic across all 257 records and both receipt variants. Fixed numeric-ID coercion, identity-width mismatch and duplicate-row truncation metadata. Dependency audit after patching static hosting: zero known vulnerabilities.
- Phase 3: `npm run check` — 70/70 tests passed and production build passed. Browser opened AC directly without visiting hub, listed only two eligible alerts, displayed metadata and both ac-101 pages, disabled next at final page, showed Beauty empty results, and retained Home filtering on return from ac-102. Independent tests cover all-store scope, null expiry, inclusive dates, metadata/page authorization and escaped active-markup inputs. Corrected timestamp rollover and bounded page layout; HTTP JSON bodies are limited to 1 MiB. Pages are synthetic SVG, not original PDFs/PNGs.
- Phase 4: `npm run check` — 76/76 unit/integration/review tests plus 5/5 compiled-bundle checks passed; TypeScript and Vite build passed. New store mode appeared on the unchanged Phase 3 UI build after runtime restart; store 1002 returned only 70002/70004. SHA-256 verified Thread, shell and TH UI sources unchanged, and all 9 built UI files byte-identical after rebuild (see REUSE-EVIDENCE.json). Real browser requests logged no app asset on hub load, TH entry only on TH launch, and AC entry on direct AC launch. Two distinct HTTP upstream origins changed data while preserving the browser route/contract. This proves this approved variation, not arbitrary new workflows without code.
- Phase 5: final `npm run check` — 88/88 unit/integration/review tests and 5/5 compiled-artifact checks passed (93 total); TypeScript and Vite production build passed. Dependency audit reported zero known vulnerabilities. Browser verified the final TH electronic receipt and AC second page with correct navigation bounds; the final demo tab reported no console warnings/errors. A separate failure fixture proved that module-load errors remain visible while the healthy app still opens; that temporary server was stopped. Keyboard checks covered tabs, restored focus, and horizontal panning. At 375 px, actual-size document viewing has no global overflow and the left edge remains reachable; fixed a centering defect found during this check. Restricted profile removed TH and denied its APIs, then the associate profile was restored. Final screenshots are in `test-artifacts/screenshots`; the normal loopback demo remains running. Source was formatted, and startup, demo steps, reuse evidence and production boundaries are documented in README.md and SOURCE-MAPPING.md.

All five local POC gates have passed. This is not production or full-SOW acceptance;
the integrations and deliverables listed in README.md remain future work.

## Theme follow-up — passed

Reviewed the live Macy's public header/footer, then replaced the provisional
cream/burgundy styling with white/neutral surfaces, black primary actions,
sans-serif typography and the official locally served red-star/black-wordmark
SVG. The storefront's main content was access-restricted; no access restriction
was bypassed. No proprietary font files, remote theme dependencies, app policy
or API mappings were added. README.md records the reference URLs and boundaries.

`npm run check` passed 92/92 tests plus 6/6 compiled-artifact checks (98 total),
including new contrast, self-contained SVG and local asset-serving checks;
TypeScript and Vite production build passed. Browser checks confirmed both apps
still launch, TH returns four matches, and AC renders the themed document page.
At the 375 px viewport, the hub and actual-size document viewer had no global
horizontal overflow; the document left edge remained reachable. The final demo
tab had no console errors/warnings, and temporary viewport sizing was reset.
Updated evidence: `test-artifacts/screenshots/macys-theme-*.jpg`.

## Web/POS presentation follow-up — passed

Added an explicit Web view / POS view switch, URL-preserved presentation mode,
and a register-oriented shell. Associate Communications adds a legacy-inspired
T1–T8 key rail, category menu and simulated return-to-POS screen. The document
journey stays mounted when switching, retaining the filter, selected document,
page and zoom. Both presentations use the same manifests, session checks,
document DTOs and API operations; presentation is not an authorization input.
Training Alerts is working; other categories and physical printing remain
disabled. Browser shortcuts are Alt+number, not native register function keys.

The final full gate passed 105/105 tests plus 6/6 compiled-artifact checks (111
total), and the TypeScript/Vite production build. After the final cosmetic
key-label spacing change, the production build and all six artifact checks were
rerun successfully. New tests cover mode parsing, internal navigation safety,
event cleanup, accessible switching, command/data gating, keyboard safeguards
and honest simulation boundaries. Both app entry bundles still reuse the same
Thread/React chunks and remain dynamically loaded.

Browser verified direct POS launch, Training Alerts, document details/pages,
Alt+2 viewer launch, Alt+8 simulated exit/return, preservation of page 2 and
actual-size zoom when toggling both ways, and retained Apparel filtering.
At 1024×768 the complete host/rail fits without outer overflow; at the 375 px
viewport the layout has no global horizontal overflow. The POS page region is
keyboard-focusable in both fit-width and actual-size modes. Browser review found
and corrected key-label spacing and menu-heading focus-outline overlap.
Final smoke also opened Transaction History from the POS hub, searched four
transactions and retained those results when switching to Web view. The final
demo tab had no console warnings/errors, and viewport overrides were reset.
Evidence is in `test-artifacts/screenshots/pos-communications-*.jpg`.

This is a browser-based POS presentation simulation, not a register deployment.
No device service, printer, remote network exposure, production POS identity,
offline cache or real offer redemption was added. Central asset delivery to a
compatible POS host remains an approved integration/deployment step.

## In-product implementation map follow-up — passed

Added **See how it works** to the application hub. The disclosure renders the
Bobbin → Spool → Thread flow, actual manifest wiring for the applications
available to the current session, and a component-reuse matrix derived from
those manifests. It explicitly separates shared runtime/UI infrastructure from
app-specific journeys, adapters and legacy business rules. Capability-filtered
sessions do not expose an unavailable app in the map.

The full gate passed 108/108 automated tests plus 6/6 compiled-artifact checks
(114 total), including three implementation-map tests, and the TypeScript/Vite
production build. Browser verification confirmed two real manifest cards,
eight Thread component rows, accessible open/close state, no console warnings or
errors and no page-level horizontal overflow at 375 px. The component table is
locally scrollable at narrow widths. The static server was restarted after the
build so its cached asset allowlist includes the new hashed CSS and Thread chunk.
Evidence: `test-artifacts/screenshots/implementation-map.jpg`.

## Two-app reuse audit follow-up — passed

Corrected the implementation map to stay within the two modernized applications.
The audit found four duplicated patterns and extracted them into the shared Thread
package: `ContextBar`, `RequestError`, `ResultsSummary` and `BackButton`. Both app
modules now consume those shared implementations, their manifests report them as
reused, and the map points to the actual usage in each app. Transaction-specific
summary/receipt behavior and communications-specific document/viewer behavior
remain specialized rather than being forced into misleading abstractions.

The full gate passed 111/111 automated tests plus 6/6 compiled-artifact checks
(117 total), including shared-component and implementation-map coverage, and the
TypeScript/Vite production build. Browser verification evidence:
`test-artifacts/screenshots/two-app-reuse-audit.png`.

## Binder and management structure follow-up — passed

Reorganized the POC into explicit `platform/{thread,spool,binder,bobbin,contracts,management}`
and `applications/{transaction-history,associate-communications}` ownership boundaries.
The Associate Communications POS menu is now a real runtime data load from a typed,
capability-protected mock Binder API. The application validates all eight items and
uses an action allowlist; Binder data cannot introduce code, external routes or
arbitrary operations. The implementation map now shows Bobbin → Spool → Binder →
Thread and identifies the live Binder route.

The gate passed 114/114 automated tests plus 6/6 compiled-artifact checks (120
total), TypeScript type checking and the Vite production build. This establishes
the internal separation and a two-app runtime pilot. A production 270-app catalog
still requires signed/versioned artifacts, capability-filtered catalog paging,
independent deployment, compatibility policy, observability and rollout/rollback.

## Thread inventory Phase 1 — passed

Defined the governed Thread inventory contract without yet registering component
records. A component now has a permanent `thread.component.*` object ID, semantic
implementation versions, owner and issue metadata, safe code/Figma bindings,
quality results and a constrained lifecycle. Validation rejects unknown fields,
unsafe paths, executable/URL-like identities, duplicate versions, partial Figma
mappings and invalid release pointers.

Lifecycle policy allows agents and engineers to create candidates and submit them
for review. Agents cannot approve inventory entries. Only governance can approve,
deprecate or retire a version, and approval requires passed test, accessibility,
design and security gates. Seven focused contract/governance tests were added.
Phase 2 will create inventory records for the existing Thread components.

## Thread inventory Phase 2 — passed

Registered the twelve React components actually exported by Thread: `BackButton`,
`Badge`, `Button`, `ContextBar`, `DataTable`, `Feedback`, `PageHeader`, `Panel`,
`QueryForm`, `RequestError`, `ResultsSummary` and `Tabs`. Each record has a stable
`thread.component.*` object ID, baseline semantic version, Thread Platform owner,
issue label, code binding, category, lifecycle state and quality/Figma status.

The baseline is deliberately recorded as `review`, not falsely approved. Existing
automated tests pass, but formal accessibility, design and security gates remain
pending and no Figma IDs were invented. Registry access returns defensive copies
so callers cannot mutate approval data. Runtime-export coverage, uniqueness,
lookup behavior and manifest differences are tested. `Receipt` and
`DocumentViewer` remain explicitly application-local because reuse is not yet
demonstrated; `money` remains a non-component formatting helper. Phase 3 builds
on these records with exact Spool manifest references.

## Thread inventory Phase 3 — passed

Migrated both Spool manifests from unversioned component names to exact Thread
inventory `{ objectId, version }` references. Runtime validation rejects malformed,
unknown, duplicate and unavailable references, and registry resolution returns the
matching component and implementation version. `Receipt` and `DocumentViewer`
are now declared through a separate application-local field and no longer appear
in the Thread reuse matrix.

The implementation map exposes each manifest's exact inventory references and
application-local components. Existing applications may document use of the
honest `review` baseline; this does not bypass the governance requirement that
new adoption target an approved version. The full gate passed 127/127 automated
tests plus 6/6 compiled-artifact checks (133 total), TypeScript type checking and
the Vite production build. Phase 4 builds on this with a management inventory
view for status, ownership, quality gates and issue tracking.

## Thread inventory Phase 4 — passed

Added a read-only management inventory to the in-product implementation map.
Every registered component version now exposes its stable object ID, category,
owner team, issue label, package/export binding, lifecycle status, four quality
gates, Figma mapping state and application usage derived from exact Spool
references. A compact summary reports review, approval and Figma-mapping counts.

The view does not mistake current POC usage for approval: all twelve imported
versions remain in `review`, and every card states that new adoption is blocked.
Capability-filtered sessions derive usage from only their available manifests
while retaining the governed catalog. Three focused management tests cover the
summary, exact usage derivation and rendered evidence fields. The full gate
passed 130/130 automated tests plus 6/6 compiled-artifact checks (136 total),
TypeScript type checking and the Vite production build. Phase 5 builds on this
catalog with the governed candidate/request workflow.

## Thread inventory Phase 5 — passed

Implemented the governed missing-component domain workflow under
`platform/thread/pipeline`: `requested → candidate → review → approved`. Requests
use stable proposed object IDs and safe application/Figma source identifiers.
Agents and engineers may attach versioned React candidates; Figma-backed
candidates must preserve the exact requested identifiers. Passed automated test
evidence is required before review submission.

Evidence updates are role-bound: agents cannot forge accessibility, design or
security approval, audit timestamps cannot move backwards, and unsupported fields
or unsafe source paths are rejected. Designers/engineers may record their formal
review evidence and return work for revision. Only governance can approve after
all four evidence-backed gates pass. Approval produces a validated, defensively
copied inventory-ready record without mutating the current registry.

The management view shows this enforced workflow and reports zero active requests
instead of inventing a component or Figma mapping. Seven focused workflow tests
cover requests, source matching, evidence, rework, permissions and promotion. The
full gate passed 137/137 automated tests plus 6/6 compiled-artifact checks (143
total), TypeScript type checking and the Vite production build. Phase 6 can wrap
this domain layer with a capability-protected inventory/request API and a durable
repository suitable for future Figma and agent adapters.

## Thread inventory Phase 6 — passed

Wrapped the Phase 5 workflow with capability-protected Bobbin routes under
`/api/thread/v1`. Ordinary application sessions can read the inventory but cannot
list or mutate component requests. Thread workflow roles are supplied only by
trusted server configuration: request bodies cannot claim an actor, all configured
workflow roles may read/write requests according to the domain rules, and only a
governance identity receives the separate approval capability.

Added a validated file-backed mock repository at `runtime/thread-requests.json`
plus an in-memory test implementation. The file repository revalidates every
record, limits envelope size/count, rejects duplicate request and object IDs,
uses exact-file temporary replacement with backup recovery, and rejects stale
updates through optimistic timestamps. Corrupt storage fails closed with a safe
service error. It is deliberately a single-process POC store, not a distributed
database or production authentication boundary.

The management view now describes the live API and storage boundary while keeping
the current application browser read-only for workflow requests. Eight focused
API/repository tests cover restart persistence, interrupted-write recovery,
malformed storage, stale updates, object reservation, actor spoofing, role
separation, governance-only approval and safe failure responses. The full gate
passed 145/145 automated tests plus 6/6 compiled-artifact checks (151 total),
TypeScript type checking and the Vite production build. Phase 7 can add the
inventory-first discovery adapter used by Figma/agents: resolve an approved match
before opening a governed request for an actual inventory miss.

## Thread inventory Phase 7 — passed

Implemented inventory-first discovery under `platform/thread/discovery`. Every
typed potential request is validated and searched against governed inventory
before workflow creation. Exact approved current versions return `reuse`. Exact
blocked records and deterministic lexical/category alternatives return
`review-alternatives` and halt automatic creation. Only `inventory-gap` permits a
configured Thread actor to open a request.

The matcher exposes its signals and stable ordering instead of claiming opaque AI
semantic certainty. It preserves validated application/Figma source identifiers
for traceability and rejects repeat work by reserved object ID or by the same
name/category/source requirement. The read-only discovery preview is available to
ordinary application sessions; the discover-and-request endpoint remains behind
the Phase 6 workflow capability and derives its actor server-side.

The management view now shows the three decisions and a live non-persisting Button
probe. Because the current Button version is still in review, it is correctly
reported as blocked and no request is created. No live Figma connection, mapping
or approved baseline was invented. Nine focused discovery/API tests cover blocked
and approved exact matches, deterministic alternatives, genuine gaps, source
traceability, duplicate prevention, preview authorization, guarded creation and
payload spoofing. The full gate passed 154/154 automated tests plus 6/6
compiled-artifact checks (160 total), TypeScript type checking and the Vite
production build. Phase 8 can add the agent candidate-build job contract and a
human workbench for inspecting requests, evidence and review actions.

## Thread inventory Phase 8 — passed

Implemented the safe build-orchestration boundary under `platform/thread/jobs`.
Each requested inventory gap may own one durable job that advances through
`queued → running → candidate-ready → attached`. Agent and engineer roles may
create, claim and advance jobs. The claiming role submits a versioned React code
binding and test evidence, but the output remains inert metadata and does not
change the component request until a separate authorized attach operation.

Added a bounded, validated file repository at
`runtime/thread-build-jobs.json`, with duplicate-request protection, atomic
replacement, backup recovery and optimistic timestamps. Attachment writes the
request first and recognizes the exact committed candidate on retry, so an
interrupted two-repository update can safely finish without accepting different
output. Malformed storage fails closed and protected API responses do not expose
repository contents.

Bobbin now exposes protected build-job and role-aware workbench routes. The
workbench combines durable requests and jobs and returns only valid next actions
for the configured server-side actor. The default application browser still has
no workflow-record access. The management view shows the implemented lifecycle,
routes, role boundary and explicit non-goals rather than fabricating a live job.

Ten focused build-job/domain/API tests cover inert output, lifecycle roles,
source binding, actor spoofing, attachment and retry recovery, persistence,
duplicate and stale-write rejection, corrupt storage, application-session
isolation and state-derived workbench actions. The full gate passed 164/164
automated tests plus 6/6 compiled-artifact checks (170 total), TypeScript type
checking and the Vite production build. No live Figma connector, agent invocation,
package publication or generated-code execution was added.

## Thread inventory Phase 9 — passed

Added the artifact-manifest quarantine under `platform/thread/artifacts`.
Candidate-ready job output can no longer attach through Bobbin on metadata alone.
The claiming build role stages a manifest whose package version and React binding
are derived from the exact job candidate. The record also carries a SHA-256
identity, bounded archive size, fixed gzip media type, build-log reference and
SBOM reference.

An engineer records provenance, dependency-audit and license-review evidence.
All three gates must pass for `verified`; any failure creates a terminal
`rejected` record. Rejected attempts remain in history while allowing a new
immutable attempt. One active or verified artifact is allowed per build job, and
verified package/content identity cannot be rewritten. The role-aware workbench
now derives stage, verify and attach actions from request, job and artifact state.

Added a third validated durable repository at `runtime/thread-artifacts.json`
with bounded envelopes, atomic replacement, backup recovery, optimistic
timestamps and safe corruption responses. Default application sessions cannot
list artifact manifests. Bobbin attachment returns a conflict until the exact
job has a verified artifact. The management view presents the real quarantine
flow, three gates and API boundary while reporting zero fabricated manifests.

Six focused artifact/domain/API tests cover derived package identity, role
separation, digest and size constraints, verification/rejection, replacement
history, immutable updates, durable persistence, corruption failure and the
verified-before-attach API gate. The full gate passed 170/170 automated tests
plus 6/6 compiled-artifact checks (176 total), TypeScript type checking and the
Vite production build.

## Thread inventory Phase 10 — passed

Added the controlled adapter boundary under `platform/thread/automation`.
Replaceable design-source, component-builder and artifact-inspector interfaces
now connect the Phase 7 discovery decision to the Phase 8 job and Phase 9
quarantine records. The deterministic mock Figma adapter accepts only two
reviewed fixture IDs. The Button fixture proves that existing inventory halts
generation; the promotion-banner fixture proves the genuine-gap path.

For a gap, the agent role creates the request, queues and claims one build job,
selects a static reviewed React template, submits validated candidate/test
metadata, compresses the bounded source in memory and computes SHA-256 and byte
size on the server. The archive bytes are discarded. The resulting artifact is
staged—not verified or attached—so the existing engineer gate remains mandatory.
No generated source is imported, executed, installed or published.

Adapter invocations have a fourth validated durable repository at
`runtime/thread-adapter-runs.json`. Each record contains a correlation ID, exact
adapter versions, discovery decision, produced request/job/artifact IDs and a
bounded terminal failure. Reusing a run ID safely returns the same record. The
browser contract accepts only `runId` and an allow-listed `fixtureId`; arbitrary
Figma URLs, tokens, prompts, commands and package bytes are rejected before any
adapter executes. Default application sessions cannot inspect or invoke runs.

Nine focused automation/domain/API/repository tests cover allow-listing,
defensive copies, server-computed gzip hashes, inventory stops, gap orchestration,
idempotent replay, durable failure correlation, file persistence, corruption
failure, application-session isolation and unsafe-field rejection. The full gate
passed 179/179 automated tests plus 6/6 compiled-artifact checks (185 total),
TypeScript type checking and the Vite production build.

Phase 10 deliberately uses deterministic mocks rather than real Figma credentials
or a generative service. The contract boundaries are replaceable, but production
identity, secret management, enterprise scanners, signing, package publication,
multi-node persistence and rollout controls remain outside this local POC.

## Thread inventory Phase 11 — passed

Added the governed release boundary under `platform/thread/releases`. Promotion
requires governance plus one exact, complete evidence chain: an approved request,
its attached build job and that job's verified artifact. Identity, version,
package, export and SHA-256 bindings are revalidated before a release can be
created. The durable release stores those immutable source identities together
with the validated component and artifact snapshots.

The runtime inventory catalog now combines the static baseline with those release
snapshots. The inventory endpoint, discovery routes and Phase 10 automation all
consume the same provider, so a promoted component is immediately found as an
approved reusable version. Static and runtime object/name conflicts fail closed.
The governance workbench derives `promote-release` and `rollback-release` from
the combined request, job, artifact and release state.

Rollback never deletes the record or reopens a duplicate request. It records a
bounded reason and evidence reference, preserves the release/source chain and
changes the component snapshot from `approved` to `deprecated`. Discovery then
returns `review-alternatives`, blocking new adoption while leaving audit evidence
available. Releases persist in the fifth validated repository,
`runtime/thread-releases.json`, using bounded envelopes, atomic replacement,
backup recovery, validation and optimistic timestamps.

Eight focused release/domain/API/repository tests cover role separation, exact
source-chain promotion, catalog reuse, audit-preserving rollback, workbench
actions, immutable identities, file persistence, corruption failure, application
session isolation and strict payload rejection. The full gate passed 187/187
automated tests plus 6/6 compiled-artifact checks (193 total), TypeScript type
checking and the Vite production build.

## Runtime topology Phase 12 — revised for the one-Hub direction

The outdated per-application Bobbin topology has been replaced by one OneX Hub single-spa root
config and a separate static MFE asset host shaped like GCP Storage. Transaction History and
Associate Communications remain separate build entries and manifests, but they are JavaScript
bundles mounted into the same browser application rather than UI containers. One shared synthetic
session service, an Apigee mock and the synthetic legacy backend preserve the unresolved enterprise
boundaries.

`npm run start:topology` runs five loopback HTTP services without Docker. `compose.yaml` models the
same boundaries: Hub, MFE storage, session, Apigee and backend. Bobbin remains the temporary Hub,
session and API fallback while Enterprise Architecture proves how static hosting will replace
those server-side responsibilities.

Focused topology tests cover manifest rewriting to the storage origin, storage path/CORS/cache
policy, one-Hub capability enforcement and end-to-end Apigee traversal. The management view now
shows the one-Hub flow and labels Binder as an internal POC adapter rather than a confirmed client
platform product.

All twelve local POC phases remain represented. This is proof of the replaceable UI and API
boundaries, not a production publishing system: real ForgeRock, Figma and agent providers,
enterprise secrets, external scanners, artifact signing, GCP Storage/CDN publication, the final
MFE resolver, HA persistence and operational observability remain production-program work.
