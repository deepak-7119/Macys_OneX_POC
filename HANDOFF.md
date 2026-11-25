# Overlock POC handoff

## Outcome

The two supplied legacy applications now run as routed journeys behind one public Gateway and a
common Bobbin base. Hub, Transaction History and Associate Communications use separate runtime
profiles, while all three resolve one shared synthetic session. The applications share the
same governed Thread components while keeping their domain behavior and Binder
data adapters separate. The local POC also proves a controlled path for adding a
missing component to the reusable inventory without granting an agent approval or
publication authority.

All twelve implementation phases are complete. The quality gate covers 190
automated tests, 6 compiled-artifact checks, TypeScript type checking and the
Vite production build. All identities, transactions and communications remain
synthetic.

## Architecture ownership

| Layer           | Owns                                                                    | Does not own                                             |
| --------------- | ----------------------------------------------------------------------- | -------------------------------------------------------- |
| Thread          | Reusable React UI, stable component IDs, lifecycle and quality evidence | Business data, backend URLs or application authorization |
| Spool           | Reviewed app manifests, routes, launch mode and exact Thread references | Arbitrary remote JavaScript or business rules            |
| POC API adapter | Typed data-load contracts and backend adapters                          | A confirmed client platform product or page composition  |
| Bobbin          | Temporary Hub host, session and API fallback boundary                   | Per-application UI runtimes or app-specific workflows    |
| MFE storage     | Independently published static MFE modules and shared chunks            | Authentication, sessions or backend APIs                 |

## Phase map

| Phases | Capability delivered                                                                    | Management evidence                                           |
| ------ | --------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| 1–4    | Inventory contract, 12 component records, versioned Spool references and inventory view | Component IDs, owners, code bindings, gates and app usage     |
| 5–7    | Governed request/review flow, protected durable APIs and inventory-first discovery      | Roles, decisions and blocked/reuse/gap outcomes               |
| 8–10   | Build jobs, artifact quarantine and replaceable mock Figma/builder/inspection adapters  | Human checkpoints, workbench actions and adapter boundaries   |
| 11     | Governance promotion, runtime catalog, reuse, rollback and preserved audit              | Exact evidence chain, release actions and non-goals           |
| 12     | One Hub, static MFE storage, shared session, Apigee mock and backend boundary           | Five live services, lazy loading and end-to-end request proof |

The in-product **See how it works** view presents this compact phase map and the
detailed Phase 11 lifecycle plus the Phase 12 runtime topology. It is intended for management walkthroughs without
turning the application into a project-status system.

## End-to-end component lifecycle

1. Discovery searches the validated static plus runtime Thread catalog.
2. An approved exact version returns `reuse`; a related or blocked version returns
   `review-alternatives`; only a genuine gap can open a request.
3. An agent or engineer may create a candidate build job, but the output remains
   inert metadata and generated source is never executed.
4. An engineer verifies artifact provenance, dependency-audit and license evidence.
5. Designer and engineer roles record accessibility, design and security evidence;
   governance alone approves the request.
6. Governance promotes the exact approved request, attached job and verified
   artifact into the runtime catalog.
7. Later discovery returns the permanent object ID and approved version for reuse.
8. Governance may roll back the release. The version becomes deprecated and new
   adoption is blocked, while the release and evidence chain remain available.

## Runtime records and APIs

Validated local repositories live under `runtime/` for requests, build jobs,
artifacts, adapter runs and releases. They are single-process POC stores with
bounded validation, atomic replacement, backup recovery and optimistic
timestamps—not a production multi-node database.

All application sessions can read the combined inventory and preview discovery.
Workflow, job, artifact, automation and release records require a server-configured
Thread identity. Promotion and rollback require governance. Important Phase 11
routes are:

- `GET /api/thread/v1/inventory`
- `POST /api/thread/v1/discovery`
- `GET /api/thread/v1/workbench`
- `GET /api/thread/v1/releases`
- `POST /api/thread/v1/requests/:requestId/releases`
- `POST /api/thread/v1/releases/:releaseId/rollback`

## Suggested demonstration

1. Open the landing page and launch both applications to show one Hub lazy-loading separate MFEs.
2. Use Associate Communications in Web and POS view to show presentation reuse.
3. Open **See how it works** and walk through Thread, Spool, MFE storage, OneX Hub and the Bobbin fallback.
4. Show the shared/specialized component inventory, five runtime services and Phase 1–12 map.
5. Use the Phase 10 examples to explain inventory-first automation and the human
   verification stop.
6. Finish on Phase 12: trace Hub/POC adapter → Apigee mock → backend, then relate that
   deployment boundary to the Phase 11 governed inventory.

## Production scale path

The separation can support a catalog of 270 applications because Bobbin loads only
the selected reviewed application bundle and Thread components remain versioned
references. Production adoption still requires enterprise identity and secrets,
real Figma/agent integrations, approved scanners, signed artifacts, package or CDN
publication, compatibility policy, a transactional multi-node database, rollout
controls, telemetry and operational ownership. Apigee remains the governed API
front door; Binder maps its versioned products to typed UI-facing contracts.

The Phase 11 rollback is a component-catalog control. It intentionally does not
claim to remove an already deployed bundle or redirect live production traffic.
