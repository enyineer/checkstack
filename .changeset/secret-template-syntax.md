---
"@checkstack/gitops-common": minor
"@checkstack/gitops-backend": minor
"@checkstack/gitops-frontend": minor
"@checkstack/healthcheck-backend": patch
"@checkstack/catalog-backend": patch
---

### Schema-driven secret resolution, rotation invalidation, and security hardening

**Breaking**: Replaced `{ secretRef: "..." }` object syntax with `${{ secrets.NAME }}` template interpolation. The `secretField()`, `secretRefSchema`, `isSecretRef`, `SecretRef`, and `ResolvedSecretField` exports have been removed from `@checkstack/gitops-common`.

**Breaking**: `ReconcileContext.resolveSecretsBySchema()` now returns `{ resolved: T; warnings: string[] }` instead of `T` directly. Plugins must destructure the result. Warnings contain messages for `${{ secrets.NAME }}` templates found in non-secret fields (fields without `x-secret` annotation).

**New features**:
- Secrets can be referenced in **any string field** using `${{ secrets.NAME }}` syntax
- Inline interpolation is supported: `"postgres://user:${{ secrets.DB_PASS }}@host/db"`
- Resolution is **schema-driven** — reuses the existing `configString({ "x-secret": true })` pattern from DynamicForm
- Secret rotation now automatically invalidates affected entities, triggering re-reconciliation on the next sync cycle
- New `getSecretUsage` RPC endpoint to look up which entities reference a given secret
- Secrets UI now shows an expandable usage panel per secret showing referencing entities
- Reconciliation warnings: templates in non-secret fields are detected and surfaced in the provenance UI
- New `secretNameSchema` and `SECRET_NAME_REGEX` exports for validating secret names

**Security**:
- Secret names are validated at creation: must start with a letter, contain only `[a-zA-Z0-9_-]`, max 63 chars
- Secrets are validated to exist at sync time but **not pre-resolved** into the spec
- Templates in `metadata` fields are **rejected** to prevent secret leaks via display fields
- Only fields with `x-secret` schema annotations get resolved — no escape hatch
- Templates in non-secret fields emit warnings (stored in provenance, visible in UI) instead of silently passing

**Migration**: Update YAML descriptors to use `${{ secrets.NAME }}` instead of `secretRef: name`. Remove `secretField()` imports from plugin schemas — use `configString({ "x-secret": true })` to annotate secret fields. Destructure `const { resolved } = await context.resolveSecretsBySchema({ value, schema })` (return type changed from `T` to `{ resolved: T; warnings: string[] }`).
