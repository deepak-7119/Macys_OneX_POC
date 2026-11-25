# Thread candidate pipeline

This folder implements the governed workflow used when a design or application
needs a component that is not present in the Thread inventory.

`requested → candidate → review → approved`

- An agent or engineer may create a typed request for an unused object ID.
- An agent or engineer may attach versioned React code. A Figma-sourced request
  must retain the exact file, component and node identifiers.
- Agents may record automated test evidence and submit a tested candidate.
- Designers and engineers record the accessibility, design and security evidence
  permitted for their role, and may return reviewed work to candidate status.
- Only governance may approve. Approval requires passed evidence for every gate
  and produces a validated inventory-ready component record.

The workflow domain operations remain pure and defensively copied. Bobbin wraps
them with `/api/thread/v1` routes and derives the actor role from trusted server
configuration; request payloads cannot claim an actor. Ordinary application
sessions may read inventory but cannot list or mutate requests. A configured
Thread actor receives request capabilities, while only governance receives the
approval capability.

The local runtime uses a validated JSON repository at
`runtime/thread-requests.json`. Writes use exact-file temporary replacement,
backup recovery and optimistic timestamp checks. The in-memory implementation is
used for isolated tests. This is durable POC storage, not a multi-node production
database or an enterprise identity system.

The pipeline still does not execute generated code, connect to Figma, publish a
package or mutate the current inventory. Those actions require enterprise
authentication, artifact isolation/signing and an atomic registry publication
step. The management UI therefore reports zero active requests rather than
inventing a candidate or Figma mapping for this POC.
