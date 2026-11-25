# Thread inventory-first discovery

Discovery evaluates a typed potential component request against the governed
Thread inventory before workflow creation.

- `reuse` requires an exact component match with an approved current version.
- `review-alternatives` means an exact blocked component or a deterministic
  lexical/category alternative exists. Automatic request creation stops.
- `inventory-gap` means no exact or sufficiently related record exists. Only a
  configured Thread workflow actor may then open the request.

Matching is deterministic and explainable. It uses exact object/export identity,
bounded name/description token overlap and category metadata. It is not an AI
semantic claim and does not connect to Figma. The requirement and source IDs are
returned unchanged after validation so later adapters have a traceable decision.

The current twelve baseline components remain in `review`, so an exact lookup is
reported as blocked rather than reusable. Production Figma/MCP adapters can call
the same API after enterprise identity, approved tool permissions and component
publication are integrated.
