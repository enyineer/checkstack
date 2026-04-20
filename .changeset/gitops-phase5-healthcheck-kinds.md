---
"@checkstack/gitops-common": minor
"@checkstack/gitops-backend": minor
"@checkstack/healthcheck-backend": minor
"@checkstack/healthcheck-frontend": minor
"@checkstack/catalog-backend": patch
---

### GitOps Ecosystem: Healthcheck Kind Registration (Phase 5)

**gitops-common**: Added required `resolveEntityRef` to `ReconcileContext`, enabling extension reconcilers to resolve cross-kind entity references (e.g., healthcheck refs in System extensions).

**gitops-backend**: Updated reconciler to populate `resolveEntityRef` by querying local provenance — no RPC round-trip needed.

**healthcheck-backend**: Registered `kind: Healthcheck` and `System → healthchecks` extension with the EntityKindRegistry:
- Validates strategy configs against registered strategy schemas at reconcile time
- Validates collector configs against registered collector schemas at reconcile time
- Manages system ↔ healthcheck associations with automatic stale removal

**healthcheck-frontend**: Added GitOps provenance locking to the HealthCheck IDE editor — GitOps-managed health checks show a lock banner and disable editing.

**catalog-backend**: Updated test fixtures for new required `resolveEntityRef` context field.
