# Thread React components

Thread owns reusable, presentational UI. `index.tsx` exports `PageHeader`, `Panel`, `Feedback`, `Button`, `DataTable`, `QueryForm`, `Badge`, `Tabs`, `ContextBar`, `RequestError`, `ResultsSummary`, `BackButton`, and the `money` display helper.

The adjacent `inventory`, `discovery`, `pipeline`, `jobs`, `artifacts`,
`automation`, and `releases` folders govern how components are identified,
searched, requested, built, quarantined, reviewed, promoted and rolled back.
Phase 10 automation runs inventory-first, replaceable design, builder and
inspection adapters and stops at human verification. Phase 11 permits governance
to promote only the exact approved-request, attached-job and verified-artifact
chain into the runtime inventory catalog. Build jobs and artifact manifests store
candidate bindings, content identities and evidence as inert metadata; they do
not execute generated source or bypass human review.

`inventory/registry.ts` assigns stable object IDs and baseline version `1.0.0`
to the twelve React components. These imported records are in review pending
formal accessibility, design and security approval. The `money` helper is not a
component and is not inventoried.

`releases/catalog.ts` combines that reviewed static registry with validated
runtime releases. Active approved releases are reusable; rolled-back snapshots
remain visible as deprecated records so discovery blocks new adoption while the
audit chain stays intact.

Applications supply domain data, operation bindings and event handlers. Thread does not choose backend URLs, implement store eligibility, authorize a transaction, or fetch documents. `DataTable` is used by both application journeys; `QueryForm` renders fields from the Spool manifest without a fixed field count.

## Composition

`PageHeader` provides the page's `h1`. Its `tabIndex=-1` lets an application move focus to the new view's heading. Back navigation should restore the selected `DataTable` action when it exists; selected actions expose `aria-current=true`.

`Tabs` accepts `items`, `active`, `onChange`, plus optional `label` and `idPrefix`. With `idPrefix="details"` and item `id="history"`, the button receives `id="details-tab-history"` and `aria-controls="details-panel-history"`. The caller owns a matching panel with `id="details-panel-history"`, `role="tabpanel"`, and `aria-labelledby="details-tab-history"`. Keep inactive panel containers in the DOM with `hidden` so every relationship remains valid. The component supports arrow keys, Home and End.

`QueryForm` associates labels with fields, uses native required/date validation, and calls `onSubmit` without navigation. Application error handling should announce backend validation errors and preserve their request reference.

`DataTable` uses native column headers and buttons for row actions. Its wrapper allows horizontal scrolling on small screens without turning the whole page into a horizontally scrolling canvas.

`ContextBar`, `RequestError`, `ResultsSummary`, and `BackButton` are shared by both current applications. Applications still provide their domain text and navigation handlers; Thread owns the repeated structure, styling, retry presentation, and request-reference markup.

## Styling and limitations

Shared styles currently live in `platform/bobbin/shell/styles/styles.css`. The
theme follows the locally documented Macy's reference but is not an approved
internal design-system specification.

These components have targeted keyboard/markup checks, not a full accessibility audit. Document page images require meaningful text alternatives before production use; generic title/page labels do not expose document-body content to a screen reader.
