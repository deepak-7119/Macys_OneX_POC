# Thread inventory contract

Phase 1 defined the governance contract. Phase 2 registers the twelve React
components actually exported by Thread. Phase 3 binds Spool manifests to their
exact inventory object IDs and versions. Phase 4 surfaces these records in the
read-only management inventory. Phase 5 adds the governed request/candidate
pipeline for an inventory miss. Each baseline implementation has a stable object
ID and version `1.0.0`.

The imported baseline is intentionally in `review`, not `approved`: automated
tests pass, while formal accessibility, design and security reviews remain
pending and no Figma IDs have been invented. `Receipt` and `DocumentViewer`
remain application-local because reuse has not been demonstrated. The `money`
export is a formatting helper rather than a component.

## Identity and versions

- A component has one permanent object ID such as `thread.component.data-table`.
- The object ID does not change when code moves or the display name changes.
- Every implementation uses semantic versioning.
- `currentVersion` must point to an approved or deprecated version.
- Spool application manifests contain the object ID and exact version instead
  of an unversioned component name. Application-local components are declared
  separately and do not appear as Thread inventory usage.

The current manifest references record existing POC usage of the imported
`review` baseline. They do not authorize a new application to adopt a component;
new adoption must target an `approved` inventory version once governance gates
are complete.

## Lifecycle

`requested → candidate → review → approved → deprecated → retired`

Agents and engineers may create candidates and submit them for review. Agents
cannot approve, deprecate or retire components. Only the governance role can
approve a reviewed component, and approval requires passed tests, accessibility,
design and security gates.

Figma bindings use identifiers rather than arbitrary URLs. A binding is either
unmapped or supplies its file, component and node IDs together. Figma mapping is
tracked separately from approval so existing code can be inventoried honestly
before a design-library mapping is created.
