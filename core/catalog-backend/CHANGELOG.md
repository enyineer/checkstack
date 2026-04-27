# @checkstack/catalog-backend

## 0.6.0

### Minor Changes

- 298bf42: ### Notification System Optimizations

  **System context in notifications**: All notification senders (healthcheck, incident, maintenance, dependency) now include the affected system name in the notification title and body. Users can immediately identify which system is affected without clicking through to the detail page.

  **Upstream notification deduplication**: When an upstream dependency goes down affecting multiple downstream systems, the dependency notification sidecar now sends **one personalized notification per user** instead of one notification per affected system. Each user's notification lists only the systems they are subscribed to, with a link to the upstream root cause system. This prevents notification floods for users subscribed to groups containing many dependent systems.

  **New catalog endpoint**: Added `getSystemGroupIds` S2S RPC endpoint on the catalog to resolve which catalog groups contain a given system, used by the dependency plugin for efficient subscriber resolution during batched notification dispatch.

### Patch Changes

- Updated dependencies [298bf42]
  - @checkstack/catalog-common@1.5.0

## 0.5.4

### Patch Changes

- Updated dependencies [adc89a8]
  - @checkstack/gitops-backend@0.2.3

## 0.5.3

### Patch Changes

- Updated dependencies [b53a40e]
  - @checkstack/gitops-backend@0.2.2

## 0.5.2

### Patch Changes

- Updated dependencies [57d54de]
  - @checkstack/gitops-backend@0.2.1

## 0.5.1

### Patch Changes

- Updated dependencies [889dd8c]
  - @checkstack/auth-common@0.6.2
  - @checkstack/auth-backend@0.4.19
  - @checkstack/catalog-common@1.4.1

## 0.5.0

### Minor Changes

- 80cbc51: Enforce GitOps provenance lock on backend API endpoints to prevent manual configuration drift for synchronized resources.

## 0.4.4

### Patch Changes

- Updated dependencies [bb1fea0]
  - @checkstack/catalog-common@1.4.0

## 0.4.3

### Patch Changes

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

- Updated dependencies [8ef367a]
- Updated dependencies [cb65e9d]
  - @checkstack/gitops-common@0.2.0
  - @checkstack/gitops-backend@0.2.0

## 0.4.2

### Patch Changes

- Updated dependencies [79cf5f8]
  - @checkstack/gitops-backend@0.1.2

## 0.4.1

### Patch Changes

- Updated dependencies [86bab6a]
  - @checkstack/gitops-backend@0.1.1
  - @checkstack/gitops-common@0.1.1

## 0.4.0

### Minor Changes

- b01078f: Added GitOps System kind extension for managing system group associations

## 0.3.0

### Minor Changes

- 6c40b5b: Register catalog System and Group as GitOps entity kinds

  - **catalog-backend**: Registers `kind: System` and `kind: Group` with the GitOps Entity Kind Registry. The catalog now supports declarative management via YAML descriptors in Git repositories. Systems and groups are reconciled using the `metadata.gitops_entity_name` marker for cross-sync identity lookup.
  - **gitops-backend**: Wires up the delete reconciler for orphan cleanup — both automatic deletion (via `deletionPolicy: "auto"`) and manual orphan confirmation now invoke the owning plugin's `delete()` handler before removing provenance entries.

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

### Patch Changes

- 6c40b5b: ### GitOps Ecosystem: Healthcheck Kind Registration (Phase 5)

  **gitops-common**: Added required `resolveEntityRef` to `ReconcileContext`, enabling extension reconcilers to resolve cross-kind entity references (e.g., healthcheck refs in System extensions).

  **gitops-backend**: Updated reconciler to populate `resolveEntityRef` by querying local provenance — no RPC round-trip needed.

  **healthcheck-backend**: Registered `kind: Healthcheck` and `System → healthchecks` extension with the EntityKindRegistry:

  - Validates strategy configs against registered strategy schemas at reconcile time
  - Validates collector configs against registered collector schemas at reconcile time
  - Manages system ↔ healthcheck associations with automatic stale removal

  **healthcheck-frontend**: Added GitOps provenance locking to the HealthCheck IDE editor — GitOps-managed health checks show a lock banner and disable editing.

  **catalog-backend**: Updated test fixtures for new required `resolveEntityRef` context field.

- Updated dependencies [6c40b5b]
- Updated dependencies [6c40b5b]
- Updated dependencies [6c40b5b]
- Updated dependencies [6c40b5b]
- Updated dependencies [6c40b5b]
- Updated dependencies [6c40b5b]
  - @checkstack/gitops-backend@0.1.0
  - @checkstack/gitops-common@0.1.0

## 0.2.24

### Patch Changes

- Updated dependencies [26d8bae]
  - @checkstack/backend-api@0.12.0
  - @checkstack/auth-backend@0.4.18
  - @checkstack/command-backend@0.1.19

## 0.2.23

### Patch Changes

- d1a2796: Enforce stricter code quality standards and eliminate AI slop anti-patterns.

  **New utility**

  - `extractErrorMessage(error, fallback?)` in `@checkstack/common` for consistent error extraction

  **ESLint rules**

  - `react-hooks/rules-of-hooks` and `exhaustive-deps` for hook correctness
  - `no-console` in frontend packages — forces `toast` over silent `console.error`
  - `no-restricted-syntax` banning `instanceof Error` — forces `extractErrorMessage`
  - Custom `no-eslint-disable-any` rule preventing `@typescript-eslint/no-explicit-any` circumvention

  **Refactoring**

  - Replace 141 `instanceof Error` boilerplate patterns across the codebase
  - Replace swallowed `console.error` with user-visible `toast.error()` feedback
  - Remove 15 redundant `as` type casts in IntegrationsPage and ProviderConnectionsPage
  - Consolidate 3 identical callback handlers into `handleDialogClose`
  - Fix conditional React hook call in `FormField.tsx`
  - Fix unstable useMemo deps in `Dashboard.tsx`
  - Replace `useEffect`→`setState` with derived `useMemo` in `RegisterPage.tsx`
  - Rewrite `keystore.test.ts` with typed `DrizzleMockChain` (eliminating 7 `any` suppressions)
  - Delete obvious comments in `encryption.ts` and Teams `provider.ts`

- Updated dependencies [d1a2796]
- Updated dependencies [3c34b07]
  - @checkstack/common@0.6.5
  - @checkstack/backend-api@0.11.1
  - @checkstack/auth-backend@0.4.17
  - @checkstack/catalog-common@1.3.1
  - @checkstack/auth-common@0.6.1
  - @checkstack/command-backend@0.1.18
  - @checkstack/notification-common@0.2.8

## 0.2.22

### Patch Changes

- Updated dependencies [54a5f80]
  - @checkstack/backend-api@0.11.0
  - @checkstack/auth-backend@0.4.16
  - @checkstack/command-backend@0.1.17

## 0.2.21

### Patch Changes

- Updated dependencies [3f36a64]
  - @checkstack/catalog-common@1.3.0
  - @checkstack/backend-api@0.10.1
  - @checkstack/auth-backend@0.4.15
  - @checkstack/command-backend@0.1.16

## 0.2.20

### Patch Changes

- Updated dependencies [23c80bc]
  - @checkstack/backend-api@0.10.0
  - @checkstack/auth-backend@0.4.14
  - @checkstack/command-backend@0.1.15

## 0.2.19

### Patch Changes

- Updated dependencies [e01945b]
  - @checkstack/auth-backend@0.4.13

## 0.2.18

### Patch Changes

- Updated dependencies [c0c0ed2]
- Updated dependencies [c0c0ed2]
  - @checkstack/backend-api@0.9.0
  - @checkstack/auth-common@0.6.0
  - @checkstack/auth-backend@0.4.12
  - @checkstack/command-backend@0.1.14
  - @checkstack/catalog-common@1.2.11

## 0.2.17

### Patch Changes

- 67158e2: Standardize package metadata, unify AJV versions to 8.18.0, and enforce monorepo architecture rules via updated ESLint configuration. This ensures consistent package discovery and runtime dependency safety across the platform.
- b839ccb: Security: Hardened production Docker image by upgrading Alpine system libraries, migrating to Drizzle beta (v1.0.0-beta.21), and implementing aggressive binary pruning to eliminate vulnerable build-time tools (esbuild/drizzle-kit).
- Updated dependencies [67158e2]
- Updated dependencies [b839ccb]
  - @checkstack/auth-backend@0.4.11
  - @checkstack/auth-common@0.5.7
  - @checkstack/backend-api@0.8.2
  - @checkstack/catalog-common@1.2.10
  - @checkstack/command-backend@0.1.13
  - @checkstack/common@0.6.4
  - @checkstack/notification-common@0.2.7

## 0.2.16

### Patch Changes

- Updated dependencies [eb353a4]
  - @checkstack/auth-backend@0.4.10

## 0.2.15

### Patch Changes

- @checkstack/catalog-common@1.2.9

## 0.2.14

### Patch Changes

- Updated dependencies [0ebbe56]
  - @checkstack/auth-backend@0.4.9
  - @checkstack/auth-common@0.5.6
  - @checkstack/backend-api@0.8.1
  - @checkstack/common@0.6.3
  - @checkstack/catalog-common@1.2.8
  - @checkstack/command-backend@0.1.12
  - @checkstack/notification-common@0.2.6

## 0.2.13

### Patch Changes

- Updated dependencies [869b4ab]
  - @checkstack/backend-api@0.8.0
  - @checkstack/auth-backend@0.4.8
  - @checkstack/command-backend@0.1.11

## 0.2.12

### Patch Changes

- Updated dependencies [3dd1914]
  - @checkstack/backend-api@0.7.0
  - @checkstack/auth-backend@0.4.7
  - @checkstack/command-backend@0.1.10

## 0.2.11

### Patch Changes

- Updated dependencies [f676e11]
- Updated dependencies [48c2080]
  - @checkstack/common@0.6.2
  - @checkstack/backend-api@0.6.0
  - @checkstack/auth-backend@0.4.6
  - @checkstack/auth-common@0.5.5
  - @checkstack/catalog-common@1.2.7
  - @checkstack/command-backend@0.1.9
  - @checkstack/notification-common@0.2.5

## 0.2.10

### Patch Changes

- Updated dependencies [e5079e1]
  - @checkstack/catalog-common@1.2.6

## 0.2.9

### Patch Changes

- 0b9fc58: Fix workspace:\* protocol resolution in published packages

  Published packages now correctly have resolved dependency versions instead of `workspace:*` references. This is achieved by using `bun publish` which properly resolves workspace protocol references.

- Updated dependencies [0b9fc58]
  - @checkstack/backend-api@0.5.2
  - @checkstack/catalog-common@1.2.5
  - @checkstack/command-backend@0.1.8
  - @checkstack/common@0.6.1
  - @checkstack/notification-common@0.2.4

## 0.2.8

### Patch Changes

- Updated dependencies [db1f56f]
  - @checkstack/common@0.6.0
  - @checkstack/backend-api@0.5.1
  - @checkstack/catalog-common@1.2.4
  - @checkstack/command-backend@0.1.7
  - @checkstack/notification-common@0.2.3

## 0.2.7

### Patch Changes

- 66a3963: Update database types to use SafeDatabase

  - Updated all database type declarations from `NodePgDatabase` to `SafeDatabase` for compile-time safety

- Updated dependencies [66a3963]
  - @checkstack/backend-api@0.5.0
  - @checkstack/command-backend@0.1.6

## 0.2.6

### Patch Changes

- Updated dependencies [8a87cd4]
- Updated dependencies [8a87cd4]
- Updated dependencies [8a87cd4]
  - @checkstack/backend-api@0.4.1
  - @checkstack/catalog-common@1.2.3
  - @checkstack/common@0.5.0
  - @checkstack/command-backend@0.1.5
  - @checkstack/notification-common@0.2.2

## 0.2.5

### Patch Changes

- Updated dependencies [83557c7]
- Updated dependencies [83557c7]
  - @checkstack/backend-api@0.4.0
  - @checkstack/common@0.4.0
  - @checkstack/command-backend@0.1.4
  - @checkstack/catalog-common@1.2.2
  - @checkstack/notification-common@0.2.1

## 0.2.4

### Patch Changes

- Updated dependencies [d94121b]
  - @checkstack/backend-api@0.3.3
  - @checkstack/command-backend@0.1.3

## 0.2.3

### Patch Changes

- @checkstack/catalog-common@1.2.1

## 0.2.2

### Patch Changes

- Updated dependencies [7a23261]
  - @checkstack/common@0.3.0
  - @checkstack/backend-api@0.3.2
  - @checkstack/catalog-common@1.2.0
  - @checkstack/notification-common@0.2.0
  - @checkstack/command-backend@0.1.2

## 0.2.1

### Patch Changes

- @checkstack/backend-api@0.3.1
- @checkstack/command-backend@0.1.1

## 0.2.0

### Minor Changes

- 9faec1f: # Unified AccessRule Terminology Refactoring

  This release completes a comprehensive terminology refactoring from "permission" to "accessRule" across the entire codebase, establishing a consistent and modern access control vocabulary.

  ## Changes

  ### Core Infrastructure (`@checkstack/common`)

  - Introduced `AccessRule` interface as the primary access control type
  - Added `accessPair()` helper for creating read/manage access rule pairs
  - Added `access()` builder for individual access rules
  - Replaced `Permission` type with `AccessRule` throughout

  ### API Changes

  - `env.registerPermissions()` → `env.registerAccessRules()`
  - `meta.permissions` → `meta.access` in RPC contracts
  - `usePermission()` → `useAccess()` in frontend hooks
  - Route `permission:` field → `accessRule:` field

  ### UI Changes

  - "Roles & Permissions" tab → "Roles & Access Rules"
  - "You don't have permission..." → "You don't have access..."
  - All permission-related UI text updated

  ### Documentation & Templates

  - Updated 18 documentation files with AccessRule terminology
  - Updated 7 scaffolding templates with `accessPair()` pattern
  - All code examples use new AccessRule API

  ## Migration Guide

  ### Backend Plugins

  ```diff
  - import { permissionList } from "./permissions";
  - env.registerPermissions(permissionList);
  + import { accessRules } from "./access";
  + env.registerAccessRules(accessRules);
  ```

  ### RPC Contracts

  ```diff
  - .meta({ userType: "user", permissions: [permissions.read.id] })
  + .meta({ userType: "user", access: [access.read] })
  ```

  ### Frontend Hooks

  ```diff
  - const canRead = accessApi.usePermission(permissions.read.id);
  + const canRead = accessApi.useAccess(access.read);
  ```

  ### Routes

  ```diff
  - permission: permissions.entityRead.id,
  + accessRule: access.read,
  ```

### Patch Changes

- Updated dependencies [9faec1f]
- Updated dependencies [827b286]
- Updated dependencies [f533141]
- Updated dependencies [aa4a8ab]
  - @checkstack/backend-api@0.3.0
  - @checkstack/catalog-common@1.1.0
  - @checkstack/command-backend@0.1.0
  - @checkstack/common@0.2.0
  - @checkstack/notification-common@0.1.0

## 0.1.0

### Minor Changes

- 8e43507: BREAKING: `getSystems` now returns `{ systems: [...] }` instead of plain array

  This change enables resource-level access control filtering for the catalog plugin. The middleware needs a consistent object format with named keys to perform post-execution filtering on list endpoints.

  ## Breaking Changes

  - `getSystems()` now returns `{ systems: System[] }` instead of `System[]`
  - All call sites must update to destructure: `const { systems } = await api.getSystems()`

  ## New Features

  - Added `resourceAccess` metadata to catalog endpoints:
    - `getSystems`: List filtering by team access
    - `getSystem`: Single resource pre-check by team access
    - `getEntities`: List filtering for systems by team access

  ## Migration

  ```diff
  - const systems = await catalogApi.getSystems();
  + const { systems } = await catalogApi.getSystems();
  ```

### Patch Changes

- Updated dependencies [97c5a6b]
- Updated dependencies [8e43507]
- Updated dependencies [8e43507]
  - @checkstack/backend-api@0.2.0
  - @checkstack/catalog-common@1.0.0
  - @checkstack/common@0.1.0
  - @checkstack/command-backend@0.0.4
  - @checkstack/notification-common@0.0.4

## 0.0.3

### Patch Changes

- Updated dependencies [f5b1f49]
- Updated dependencies [f5b1f49]
- Updated dependencies [f5b1f49]
  - @checkstack/backend-api@0.1.0
  - @checkstack/common@0.0.3
  - @checkstack/command-backend@0.0.3
  - @checkstack/catalog-common@0.0.3
  - @checkstack/notification-common@0.0.3

## 0.0.2

### Patch Changes

- d20d274: Initial release of all @checkstack packages. Rebranded from Checkmate to Checkstack with new npm organization @checkstack and domain checkstack.dev.
- Updated dependencies [d20d274]
  - @checkstack/backend-api@0.0.2
  - @checkstack/catalog-common@0.0.2
  - @checkstack/command-backend@0.0.2
  - @checkstack/common@0.0.2
  - @checkstack/notification-common@0.0.2

## 0.1.0

### Minor Changes

- a65e002: Add command palette commands and deep-linking support

  **Backend Changes:**

  - `healthcheck-backend`: Add "Manage Health Checks" (⇧⌘H) and "Create Health Check" commands
  - `catalog-backend`: Add "Manage Systems" (⇧⌘S) and "Create System" commands
  - `integration-backend`: Add "Manage Integrations" (⇧⌘G), "Create Integration Subscription", and "View Integration Logs" commands
  - `auth-backend`: Add "Manage Users" (⇧⌘U), "Create User", "Manage Roles", and "Manage Applications" commands
  - `command-backend`: Auto-cleanup command registrations when plugins are deregistered

  **Frontend Changes:**

  - `HealthCheckConfigPage`: Handle `?action=create` URL parameter
  - `CatalogConfigPage`: Handle `?action=create` URL parameter
  - `IntegrationsPage`: Handle `?action=create` URL parameter
  - `AuthSettingsPage`: Handle `?tab=` and `?action=create` URL parameters

### Patch Changes

- Updated dependencies [b4eb432]
- Updated dependencies [a65e002]
- Updated dependencies [a65e002]
  - @checkstack/backend-api@1.1.0
  - @checkstack/common@0.2.0
  - @checkstack/command-backend@0.1.0
  - @checkstack/catalog-common@0.1.2
  - @checkstack/notification-common@0.1.1

## 0.0.3

### Patch Changes

- @checkstack/catalog-common@0.1.1

## 0.0.2

### Patch Changes

- Updated dependencies [ffc28f6]
- Updated dependencies [4dd644d]
- Updated dependencies [71275dd]
- Updated dependencies [ae19ff6]
- Updated dependencies [b55fae6]
- Updated dependencies [b354ab3]
- Updated dependencies [81f3f85]
  - @checkstack/common@0.1.0
  - @checkstack/backend-api@1.0.0
  - @checkstack/catalog-common@0.1.0
  - @checkstack/notification-common@0.1.0
  - @checkstack/command-backend@0.0.2
