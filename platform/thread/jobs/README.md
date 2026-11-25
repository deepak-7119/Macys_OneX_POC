# Thread build jobs

This folder implements the controlled orchestration boundary between a missing Thread component and a candidate that can enter the existing human-governed request workflow.

The lifecycle is `queued → running → candidate-ready → attached`. Agent and engineer roles may advance build jobs. The protected Bobbin attachment route requires a verified Phase 9 artifact manifest for the exact job before copying candidate metadata and test evidence onto the related Thread request. Designer and governance decisions remain in the request workflow.

The POC does **not** execute generated source, publish a package, call the external Figma API or invoke a generative service. Phase 10's deterministic mock adapters create these inert records through the same contract. Production adapters can replace those mocks without weakening the inventory, role, validation or approval rules.

In Phase 11 the workbench also combines release state. Governance receives
`promote-release` only after request approval, job attachment and artifact
verification, then receives `rollback-release` for the active release. These are
derived next actions, not client-selected permissions.
