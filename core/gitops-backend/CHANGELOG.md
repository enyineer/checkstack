# @checkstack/gitops-backend

## 0.3.2

### Patch Changes

- b627562: Bump direct and transitive dependencies to clear MEDIUM-severity advisories
  that Trivy now surfaces alongside CRITICAL/HIGH.

  Direct version bumps in package.json:

  - `@checkstack/catalog-backend`, `@checkstack/gitops-backend`,
    `@checkstack/healthcheck-frontend`: `uuid` `^13.0.0` → `^14.0.0`
    (GHSA-w5hq-g745-h8pq, missing buffer bounds check in v3/v5/v6). Also
    dropped the now-redundant `@types/uuid` devDependency — uuid 14 ships
    its own types and the npm `@types/uuid` package is a stub.
  - `@checkstack/gitops-backend`: `yaml` `^2.7.0` → `^2.8.3`
    (GHSA-48c2-rrv3-qjmp, stack overflow on deeply nested collections).
  - `@checkstack/dev-server`: `vite` `^5.4.0` → `^8.0.12`
    (GHSA-4w7w-66w2-5vf9, path traversal in optimized-deps `.map` handling)
    and `@vitejs/plugin-react` `^4.3.4` → `^6.0.1` to stay inside the new
    vite peer range.

  Root `overrides` / `resolutions` to bypass transitive pins that block the
  walk:

  - `dompurify` `^3.4.3` — `monaco-editor@0.55.1` pins `dompurify@3.2.7`
    exactly, so the only way to pick up the eight DOMPurify XSS / prototype
    pollution advisories (GHSA-v2wj-7wpq-c8vv et al.) is an override.
    Affects `@checkstack/ui`, which is the only consumer of monaco.
  - `uuid` `^14.0.0` — also forces `bullmq`'s nested `uuid@11.1.0`
    (vulnerable per GHSA-w5hq-g745-h8pq) to the patched line. Affects
    `@checkstack/queue-bullmq-backend`.
  - `yaml` `^2.9.0` — covers transitive resolutions that would otherwise
    pin pre-2.8.3 yaml.

  The CI image scan (`.github/workflows/pr-checks.yml`) and the local
  `bun run audit:*` helper now include `MEDIUM` alongside `CRITICAL,HIGH`,
  so future MEDIUM regressions fail the pipeline. The production Dockerfile
  also strips vendored `test/`, `tests/`, `__tests__/`, `benchmark/`,
  `benchmarks/`, `example/` and `examples/` folders from `node_modules`
  before the runtime stage — those tarball artefacts ship their own
  nested `package.json` (`benchmark`, `tedious-benchmarks`, etc.) which
  Trivy was scanning as if they were real packages.

## 0.3.1

### Patch Changes

- Updated dependencies [9016526]
  - @checkstack/common@0.10.0
  - @checkstack/gitops-common@0.4.0
  - @checkstack/backend-api@0.15.2
  - @checkstack/command-backend@0.1.26
  - @checkstack/queue-api@0.3.1

## 0.3.0

### Minor Changes

- f6f9a5c: Surface the source repository for GitOps-managed entities and gate the
  system→group remove button on the system's lock state.

  - `provenanceSchema` now carries a `sourceUrl` field, derived on the
    backend from the provider type, baseUrl, repository and filePath. URLs
    are constructed for github.com / gitlab.com and self-hosted
    GitHub/GitLab where the API base ends in `/api/v3` or `/api/v4`. Other
    baseUrls fall back to `null` so the UI keeps showing the raw path.
  - New `useProvenanceLocks` hook (bulk variant of `useProvenanceLock`)
    for views that render many entities and need to look up locks
    client-side.
  - New `<GitOpsSourceBadge>` popover component that replaces the bare
    GitBranch icon on system and group catalog cards. The popover
    surfaces the repository, file path, and a "View in source provider"
    deep link.
  - `<GitOpsLockBanner>` repo line is now a real link when a sourceUrl is
    available.
  - The system→group remove button in the catalog now disables itself
    when the system is GitOps-managed, matching the backend lock that was
    already in place.

### Patch Changes

- Updated dependencies [42abfff]
- Updated dependencies [f6f9a5c]
- Updated dependencies [aa89bc5]
  - @checkstack/common@0.9.0
  - @checkstack/gitops-common@0.3.0
  - @checkstack/queue-api@0.3.0
  - @checkstack/backend-api@0.15.1
  - @checkstack/command-backend@0.1.25

## 0.2.8

### Patch Changes

- 50e5f5f: Runtime plugin system: install + uninstall plugins from npm, GitHub releases
  (including private GitHub Enterprise instances), or tarball uploads at
  runtime, with multi-package bundles, dependency-derived compatibility checks,
  multi-instance coordination via a Postgres artifact store, and
  single-coordinator destructive cleanup.

  Highlights:

  - New `PluginSource` discriminated union and `PluginInstaller` /
    `PluginInstallerRegistry` interfaces in `@checkstack/backend-api`. The
    GitHub variant accepts an optional `apiBaseUrl` so deployments backed by
    GitHub Enterprise can install from `https://ghe.example.com/api/v3`
    instead of `api.github.com`.
  - New `installPackageMetadataSchema` (Zod) in `@checkstack/common` validates
    every plugin's `package.json` at install time. Required fields: `name`,
    `version`, `description`, `author`, `license`, `checkstack.type`,
    `checkstack.pluginId`. Optional: `checkstack.bundle`,
    `checkstack.usageInstructions`, `checkstack.allowInstallScripts`.
  - New `pluginManagerContract` in `@checkstack/pluginmanager-common` with
    `list`, `previewInstall`, `install`, `previewUninstall`, `uninstall`, and
    `events` procedures.
  - New `@checkstack/pluginmanager-frontend` admin UI: installed-plugins list
    with per-row uninstall (typed-confirmation modal, schema/configs/cascade
    toggles), install page with NPM / Tarball Upload / GitHub Release tabs
    (Catalog tab disabled — coming soon), and an events page surfacing the
    install/uninstall audit log.
  - New `bunx @checkstack/scripts plugin-pack` CLI for plugin authors —
    per-package mode produces an npm-shaped tarball; `--bundle` mode produces
    an outer tarball containing every sibling declared in
    `package.json#checkstack.bundle`. Published to npm so external authors
    can `bunx` it directly without a workspace checkout.
  - Compatibility derived from `package.json#dependencies` ranges
    (`semver.satisfies` against the platform's loaded `@checkstack/*`
    versions) — no separate `compatibility` field.
  - Multi-instance: originator persists artifacts + `plugins` rows + broadcasts
    install/uninstall; receiving instances do in-process register/unregister
    only. Destructive ops (drop schema, delete plugin_configs, delete
    artifacts, delete `plugins` rows) run exactly once on the originator.
  - Fresh-instance bootstrap: `loadPlugins()` hydrates any
    `is_uninstallable=true` plugin missing from `node_modules` from the
    artifact store before normal Phase 1 register.
  - New schema: `plugin_artifacts` (tarball storage), `plugin_install_events`
    (audit/error log). `plugins` extended with `version`, `metadata`,
    `source`, `bundle_id`, `is_primary`. Local plugin sync now writes
    `version` from each plugin's `package.json` so the admin UI shows real
    versions instead of `—`.
  - Tarball-upload endpoint (`POST /api/pluginmanager/upload-tarball`) for
    the install UI; access-gated by `pluginmanager.plugin.manage`.
  - Plugin Manager menu link added to the user menu (main grid, alongside
    Profile / Notification Settings / etc.).

  Cross-cutting changes:

  - Backend request/response logging now flows through `rootLogger` (winston)
    instead of `hono/logger`. 5xx responses include the response body inline
    so swallowed early-return errors are visible in the log.
  - The `/api/:pluginId/*` dispatcher now logs which core service is missing
    or which `pluginId` had no metadata when it 500s.
  - New `registerCorePluginMetadata` on `PluginManager` for core routers
    (like the plugin manager itself) that need their metadata visible to the
    RPC dispatcher without going through the full plugin lifecycle.
  - ESLint: `unicorn/no-null` is now disabled globally. Drizzle distinguishes
    between `null` (writes a real SQL NULL) and `undefined` (skip the column
    on insert), so treating them as interchangeable produced latent bugs at
    the persistence boundary. The bulk of the patch-bumped packages above
    reflect lint-fix touches that landed when this rule was relaxed.
  - Workspace-wide license normalization to `Elastic-2.0` (matches
    `LICENSE.md`). Every `package.json` in the workspace now declares the
    same SPDX identifier; the patch bumps capture this.

  Plugin packages (every `plugins/*`): added a `pack` npm script
  (`bunx @checkstack/scripts plugin-pack`), mirrored each plugin's
  `pluginId` from `plugin-metadata.ts` into `package.json#checkstack.pluginId`
  so install-time validation passes, stubbed any missing required metadata
  fields (`description`, `author`, `license`), and added
  `checkstack.bundle` to multi-package plugin primaries (telegram, rcon, ssh,
  jira, queue-bullmq, queue-memory, cache-memory).

  Breaking changes:

  - The legacy single-method `PluginInstaller` interface (`install(packageName)`)
    is removed. Callers must use `coreServices.pluginInstallerRegistry`.
  - The old `pluginAdminContract` and `createPluginAdminRouter` are removed.
    Replaced by `pluginManagerContract` in `@checkstack/pluginmanager-common`
    and `createPluginManagerRouter` in `core/backend`.
  - `@checkstack/test-utils-backend` no longer exports
    `createMockPluginInstaller` / `MockPluginInstaller` (the legacy interface
    it shimmed is gone).

  Note: bumps are limited to `minor` (for packages with new public API
  surface) and `patch` (for downstream consumers, license normalization,
  and lint fixes). No `major` bumps despite the `PluginInstaller` removal —
  the legacy interface had no third-party consumers in the wild before this
  runtime plugin system landed, and the contract surface is the same shape
  modulo the rename.

- Updated dependencies [50e5f5f]
  - @checkstack/backend-api@0.15.0
  - @checkstack/common@0.8.0
  - @checkstack/gitops-common@0.2.2
  - @checkstack/queue-api@0.2.18
  - @checkstack/command-backend@0.1.24

## 0.2.7

### Patch Changes

- Updated dependencies [302cd3f]
  - @checkstack/backend-api@0.14.1
  - @checkstack/command-backend@0.1.23
  - @checkstack/queue-api@0.2.17
  - @checkstack/common@0.7.0
  - @checkstack/gitops-common@0.2.1

## 0.2.6

### Patch Changes

- 32d52c6: chore: add `drizzle-kit` as a dev dependency

  Lets each backend package run `drizzle-kit generate` locally without
  relying on the workspace-level binary. No runtime impact — devDeps
  only.

- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
  - @checkstack/backend-api@0.14.0
  - @checkstack/command-backend@0.1.22
  - @checkstack/queue-api@0.2.16

## 0.2.5

### Patch Changes

- @checkstack/backend-api@0.13.1
- @checkstack/command-backend@0.1.21
- @checkstack/queue-api@0.2.15

## 0.2.4

### Patch Changes

- Updated dependencies [8d1ef12]
- Updated dependencies [8d1ef12]
  - @checkstack/common@0.7.0
  - @checkstack/backend-api@0.13.0
  - @checkstack/command-backend@0.1.20
  - @checkstack/gitops-common@0.2.1
  - @checkstack/queue-api@0.2.14

## 0.2.3

### Patch Changes

- adc89a8: Fix GitOps engine skipping retry of failed entities

  - Updated the fast-path condition in the Reconciler engine to only skip reconciliation if the entity is in a `synced` state.
  - Prevents entities from remaining permanently stuck in an error state without being retried if the underlying YAML file is not modified.

## 0.2.2

### Patch Changes

- b53a40e: Fix GitOps entity update failures due to pending error records

  - Ensured the `existingEntityId` parameter in the Reconciler engine is set to `undefined` instead of a `"pending-UUID"` when handling entities that failed to sync initially.
  - Hardened the `Healthcheck` GitOps kind logic to explicitly ignore `"pending-"` IDs, preventing SQL update errors on synthetic provenance IDs.
  - Fixed a bug where resolving YAML syntax errors would cause the subsequent sync to fail with `failed query: update [...]` because it attempted to update the nonexistent `"pending-"` entity instead of creating a new one.

## 0.2.1

### Patch Changes

- 57d54de: Fix GitOps Healthcheck reconciliation engine and Kind Registry UI

  - Mandated fully qualified IDs for all healthcheck strategies and collector definitions.
  - Refactored the Kind Registry UI to display schema documentation in beautifully formatted, interactive YAML examples.
  - Entity Envelope Fields and Base Spec Schema are now displayed in collapsed accordions.
  - Fixed condition logic that broke the collector documentation display.
  - Enhanced UX by dynamically injecting fully-qualified strategy variants directly into the YAML examples.

## 0.2.0

### Minor Changes

- 8ef367a: Added `registerSpecSchemaDocumentation` to EntityKindRegistry to allow plugins to provide detailed JSON Schemas for specific configurations. The frontend now displays these registered schemas as dropdown alternatives, improving the developer experience when authoring GitOps configurations.
- cb65e9d: ### Schema-driven secret resolution, rotation invalidation, and security hardening

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

### Patch Changes

- Updated dependencies [8ef367a]
- Updated dependencies [cb65e9d]
  - @checkstack/gitops-common@0.2.0

## 0.1.2

### Patch Changes

- 79cf5f8: ### GitOps: Fix sync lifecycle management

  - Schedule recurring sync job immediately when creating a provider (previously required server restart)
  - Reschedule recurring job when provider's sync interval is updated
  - Cancel recurring job when provider is deleted
  - Fix manual sync trigger being silently dropped due to job ID deduplication

## 0.1.1

### Patch Changes

- 86bab6a: ### GitOps: Fix authentication token handling

  - Made `authToken` optional in `ReconcileProviderParams` and `ScraperOptions` to support unauthenticated access to public repositories
  - GitHub and GitLab scrapers now conditionally set authentication headers only when a token is provided
  - Sync worker now decrypts the encrypted `authToken` from the database before passing it to scrapers, fixing authentication failures caused by sending encrypted values in HTTP headers

  ### SLO: Fix premature Nines Club achievement unlock

  - The "Nines Club" achievement now requires both ≥99.99% availability **and** a 365-day compliance streak, preventing immediate unlock on newly created SLOs with 100% default availability

  ### SLO: Align frontend achievement descriptions with backend criteria

  - Fixed mismatched descriptions for Iron Uptime (7-day, not 30), Diamond Uptime (30-day, not 90), Clean Sheet (rolling window, not quarter), Full Coverage (3+ SLOs, not all systems in group), and Nines Club (99.99%)

  ### SLO: Enrich milestones with system names

  - The `getRecentMilestones` endpoint now resolves human-readable system names via the Catalog API instead of returning raw system IDs

- Updated dependencies [86bab6a]
  - @checkstack/gitops-common@0.1.1

## 0.1.0

### Minor Changes

- 6c40b5b: feat: add GitOps Entity System foundation — entity envelope schema, Entity Kind Registry extension point, secret field utility, secret resolution engine, provenance tracking, and RPC contract
- 6c40b5b: Generalized provenance system and GitOps frontend plugin

  **Breaking**: `EntityKindDefinition.reconcile()` now returns `{ entityId: string }` instead of `void`. Plugins must return the plugin-specific entity ID (e.g., catalog system UUID) so the engine can store it in provenance.

  - Added `entityId` column to the provenance table (non-nullable)
  - Reconciler engine passes `existingEntityId` to plugins for updates
  - `getProvenance` now supports lookup by `entityId` in addition to `entityName`
  - Added provider CRUD endpoints: `createProvider`, `updateProvider`, `deleteProvider`
  - Created `gitops-frontend` plugin with provider management, secret management, and sync status dashboard
  - Removed `gitops_entity_name` metadata markers from catalog entities
  - Removed `findSystemByGitOpsName`, `deleteSystemByGitOpsName` (and Group equivalents) from EntityService
  - Added provenance-based UI locking in catalog-frontend: edit/delete/drag disabled for GitOps-managed systems and groups

- 6c40b5b: ### GitOps Ecosystem: Healthcheck Kind Registration (Phase 5)

  **gitops-common**: Added required `resolveEntityRef` to `ReconcileContext`, enabling extension reconcilers to resolve cross-kind entity references (e.g., healthcheck refs in System extensions).

  **gitops-backend**: Updated reconciler to populate `resolveEntityRef` by querying local provenance — no RPC round-trip needed.

  **healthcheck-backend**: Registered `kind: Healthcheck` and `System → healthchecks` extension with the EntityKindRegistry:

  - Validates strategy configs against registered strategy schemas at reconcile time
  - Validates collector configs against registered collector schemas at reconcile time
  - Manages system ↔ healthcheck associations with automatic stale removal

  **healthcheck-frontend**: Added GitOps provenance locking to the HealthCheck IDE editor — GitOps-managed health checks show a lock banner and disable editing.

  **catalog-backend**: Updated test fixtures for new required `resolveEntityRef` context field.

- 6c40b5b: Add GitOps discovery and sync engine (Phase 2)

  - YAML document parser with multi-document support and SHA-256 content hashing for diff detection
  - GitHub scraper: org/user repo enumeration, single-repo mode, default branch resolution, recursive Git Trees API, minimatch path filtering, Link header pagination
  - GitLab scraper: group project enumeration (including subgroups), single-project mode, recursive tree walking, minimatch filtering, x-next-page pagination
  - Configurable `baseUrl` per provider for GitHub Enterprise and self-managed GitLab instances
  - Reconciliation orchestrator: scrape → parse → validate → resolve secrets → reconcile (base + extensions) → provenance tracking → orphan detection
  - Sync worker: recurring queue jobs per provider, one-off manual trigger via triggerSync RPC
  - Per-entity error isolation ensures individual failures don't halt the sync

- 6c40b5b: Add Kind Registry browser and developer documentation

  - Added `gitopsAccess.kinds.read` access rule for standalone Kind Registry access
  - Added `describeKinds()` method to the internal entity kind registry, serializing Zod schemas to JSON Schema
  - Added `listKinds` RPC endpoint gated by the new access rule
  - Created standalone Kind Registry page with schema visualization, extension listing, and auto-generated YAML examples
  - Added Kind Registry link to the user menu
  - Created developer documentation for entity kind and extension registration in `docs/backend/gitops-entity-kinds.md`

### Patch Changes

- 6c40b5b: Register catalog System and Group as GitOps entity kinds

  - **catalog-backend**: Registers `kind: System` and `kind: Group` with the GitOps Entity Kind Registry. The catalog now supports declarative management via YAML descriptors in Git repositories. Systems and groups are reconciled using the `metadata.gitops_entity_name` marker for cross-sync identity lookup.
  - **gitops-backend**: Wires up the delete reconciler for orphan cleanup — both automatic deletion (via `deletionPolicy: "auto"`) and manual orphan confirmation now invoke the owning plugin's `delete()` handler before removing provenance entries.

- Updated dependencies [6c40b5b]
- Updated dependencies [6c40b5b]
- Updated dependencies [6c40b5b]
- Updated dependencies [6c40b5b]
  - @checkstack/gitops-common@0.1.0
