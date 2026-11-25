# Thread controlled adapters

Phase 10 connects inventory discovery, a design-source adapter, a controlled component builder and artifact inspection without granting the browser direct access to Figma, credentials, prompts, commands or package bytes.

The shipped `mock-figma` adapter accepts only two reviewed fixture IDs. `inventory-button` proves that the pipeline stops when inventory already contains the requirement. `figma-promotion-banner` proves the gap path: request, build job, static reviewed template, server-side gzip/SHA-256 inspection and a staged Phase 9 artifact.

Adapter interfaces are replaceable. A production Figma connector can implement `ThreadDesignSourceAdapter`; an approved build service can implement `ThreadComponentBuilderAdapter`; and enterprise scanning can implement `ThreadArtifactInspectorAdapter`. Their secrets remain server-side and their output must still pass the existing contracts and human verification gate.

Generated source is never executed, installed or published here. The mock builder selects a static template and the inspector hashes its in-memory gzip. The archive bytes are discarded after inspection; only the bounded manifest and evidence references enter quarantine.

Each invocation creates a durable, correlation-bearing run record in `runtime/thread-adapter-runs.json`. Runs record the exact adapter versions, inventory decision, produced record chain and a bounded failure when an adapter stops.

Protected routes:

- `GET /api/thread/v1/automation/runs`
- `POST /api/thread/v1/automation/runs`
