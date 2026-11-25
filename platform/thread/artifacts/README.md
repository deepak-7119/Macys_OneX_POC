# Thread artifact staging

This folder is the quarantine boundary between candidate metadata and attachment to a governed component request.

An artifact record binds one build job to immutable package metadata: the candidate package/version, a SHA-256 digest, bounded archive size, media type, build-log reference and SBOM reference. An engineer records provenance, dependency-audit and license-review evidence. All three gates must pass before the artifact becomes `verified`; any failure records a terminal `rejected` artifact and allows a new staged attempt while preserving history.

This folder stores and validates artifact manifests only; its route does not receive archive bytes. Phase 10's controlled inspection adapter creates a bounded in-memory gzip and computes its digest before calling this boundary. Neither layer executes generated source, installs dependencies, calls an enterprise scanner or publishes a package. Bobbin attachment accepts only a verified manifest for the exact build job.
