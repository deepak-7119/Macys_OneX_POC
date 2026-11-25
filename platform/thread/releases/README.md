# Thread inventory releases

Phase 11 promotes a fully approved request backed by its exact attached build job and verified artifact into the runtime Thread catalog. Governance is the only role allowed to promote or roll back a release.

An active release stores the validated inventory component snapshot plus immutable request, job, artifact and content-digest identities. The combined inventory endpoint and discovery service include this snapshot, so later applications receive an exact `reuse` decision.

Rollback is audit-preserving. It does not delete or rewrite the package identity; it records a bounded reason/evidence reference and moves the released version from `approved` to `deprecated`. Discovery then blocks new adoption with `review-alternatives` instead of reopening an untracked duplicate request.

Protected routes:

- `GET /api/thread/v1/releases`
- `POST /api/thread/v1/requests/:requestId/releases`
- `POST /api/thread/v1/releases/:releaseId/rollback`

The POC repository is a validated single-process JSON store. Production publication, signing, CDN/package distribution, multi-region rollback and deployment orchestration remain external controls.
