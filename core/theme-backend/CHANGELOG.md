# @checkstack/theme-backend

## 0.2.4

### Patch Changes

- Updated dependencies [b50916d]
  - @checkstack/backend-api@0.21.4
  - @checkstack/auth-backend@0.5.4

## 0.2.3

### Patch Changes

- @checkstack/auth-backend@0.5.3
- @checkstack/backend-api@0.21.3
- @checkstack/common@0.14.1
- @checkstack/theme-common@0.2.2

## 0.2.2

### Patch Changes

- Updated dependencies [1fee9da]
  - @checkstack/common@0.14.1
  - @checkstack/auth-backend@0.5.2
  - @checkstack/backend-api@0.21.2
  - @checkstack/theme-common@0.2.2

## 0.2.1

### Patch Changes

- Updated dependencies [13373ce]
  - @checkstack/common@0.14.0
  - @checkstack/backend-api@0.21.1
  - @checkstack/auth-backend@0.5.1
  - @checkstack/theme-common@0.2.1

## 0.2.0

### Minor Changes

- 9dcc848: Align workspace dependency versions and migrate React Router to v7.

  BREAKING CHANGES (React Router v7): All frontend packages now depend on `react-router-dom@^7.16.0`. Previously the workspace declared four divergent ranges (`^6.20.0`, `^6.22.0`, `^7.1.1`, `^7.14.2`), which resolved both `react-router@6` and `react-router@7` into a single bundle. Everything is now unified on v7. The public imports the app uses (`BrowserRouter`, `Routes`, `Route`, `Link`, `NavLink`, `MemoryRouter`, `useNavigate`, `useParams`, `useSearchParams`, `useLocation`) are unchanged between v6 and v7, so no source rewrites were required - but any out-of-tree plugin still on react-router v6 should upgrade to v7 (see the React Router v6 -> v7 upgrade guide) to share the host's single router instance via the import map.

  Other unified ranges (no API change): `react` -> `^18.3.1`, the `@orpc/*` family (`contract`, `server`, `client`, `tanstack-query`, `openapi`, `zod`) -> `^1.14.4`, and `better-auth` -> `^1.6.13`.

  Removed the pre-rename `@orpc/react-query` leftover from `@checkstack/frontend-api`; its `createRouterUtils` / `RouterUtils` / `ProcedureUtils` now come from `@orpc/tanstack-query` (the package already in use).

  Stale in-range runtime deps pulled up to current published versions: `hono` `^4.12.23`, `@tanstack/react-query` (+devtools) `^5.100.14`, `date-fns` `^4.4.0`, `jose` `^6.2.3`, `tar` `^7.5.16`, `semver` `^7.8.1`, `@xyflow/react` `^12.11.0`.

### Patch Changes

- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
  - @checkstack/auth-backend@0.5.0
  - @checkstack/backend-api@0.21.0
  - @checkstack/common@0.13.0
  - @checkstack/theme-common@0.2.0

## 0.1.37

### Patch Changes

- Updated dependencies [a57f7db]
  - @checkstack/backend-api@0.20.0
  - @checkstack/auth-backend@0.4.33

## 0.1.36

### Patch Changes

- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
  - @checkstack/backend-api@0.19.0
  - @checkstack/auth-backend@0.4.32

## 0.1.35

### Patch Changes

- Updated dependencies [6d52276]
- Updated dependencies [35bc682]
  - @checkstack/common@0.12.0
  - @checkstack/backend-api@0.18.0
  - @checkstack/auth-backend@0.4.31
  - @checkstack/theme-common@0.1.14

## 0.1.34

### Patch Changes

- @checkstack/backend-api@0.17.1
- @checkstack/auth-backend@0.4.30

## 0.1.33

### Patch Changes

- f23f3c9: Add `correlationMiddleware` to `@checkstack/backend-api` and apply it
  to every plugin/core router so each request carries a stable
  `x-correlation-id` (read from the inbound header, or freshly minted
  via `crypto.randomUUID()` when absent) and an auto-injected child
  logger bound with `{ correlationId, pluginId, userId? }`. The ID is
  echoed back on the response header so the caller can correlate their
  client-side trace to the server logs.

  The `Logger` interface in `@checkstack/backend-api` now formally
  documents the structured-metadata convention (`logger.info("msg",
{ ...meta })`) alongside the long-standing varargs shape. Winston's
  splat handling already routes both shapes through the same vararg
  slot, so existing call sites are unaffected. A new optional
  `Logger.child(meta)` method captures the metadata-binding contract the
  new middleware relies on; production loggers always implement it,
  minimal test mocks may omit it (the middleware falls back gracefully).

  `RpcContext` grew two optional `Headers` bags, `requestHeaders` and
  `responseHeaders`, populated by the outer Hono `/api/*` and `/rest/*`
  handlers in `@checkstack/backend`. They are write-through observation
  points for middleware; an `RpcContext` constructed without them (S2S
  clients, tests) keeps working — the echo is a silent no-op and the ID
  is still bound onto the child logger for server-side correlation.

  The scaffolding template in `@checkstack/scripts` was updated so any
  new plugin generated via `bun run create` wires the middleware in the
  expected `.use(correlationMiddleware).use(autoAuthMiddleware)` order
  out of the box.

- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
  - @checkstack/common@0.11.0
  - @checkstack/backend-api@0.17.0
  - @checkstack/auth-backend@0.4.29
  - @checkstack/theme-common@0.1.13

## 0.1.32

### Patch Changes

- Updated dependencies [a06b899]
- Updated dependencies [a06b899]
  - @checkstack/backend-api@0.16.0
  - @checkstack/auth-backend@0.4.28

## 0.1.31

### Patch Changes

- b33fb4d: Refresh `bun.lock` to clear MEDIUM-severity Trivy advisories on transitive
  runtime dependencies. No public API change — bumping every workspace
  package that lists `@orpc/server` as a direct dep so consumers re-resolve
  the optional `ws` peer to the patched release on their next install.

  - `ws` `8.20.0` → `8.20.1` (CVE-2026-45736). Pulled into the install tree
    as `@orpc/server`'s optional WebSocket peer; Bun auto-installs it into
    every backend package that depends on `@orpc/server`, so a stale 8.20.0
    ships in the consumer's `node_modules` until the parent package
    re-resolves.
  - `brace-expansion` `5.0.5` → `5.0.6` (CVE-2026-45149). Pulled in only
    through dev tooling (`minimatch@10` via `@typescript-eslint` and
    `storybook`'s `glob@13`), so it does not ship to consumers and no
    workspace `package.json` lists it; the lockfile bump alone clears the
    finding for the Docker image and the local dev tree. No version bump
    is attributed to this advisory.

  The fix lives entirely in `bun.lock` — no `package.json`, `overrides`, or
  `resolutions` change is needed because both parent ranges (`minimatch@10
→ brace-expansion@^5.0.5`, `@orpc/server / storybook / happy-dom →
ws@>=8.18.x`) already accept the patched releases, and `bun install`
  keeps the resolved versions sticky after the initial `bun update`.

- Updated dependencies [1909a61]
- Updated dependencies [b33fb4d]
  - @checkstack/backend-api@0.15.3
  - @checkstack/auth-backend@0.4.27

## 0.1.30

### Patch Changes

- Updated dependencies [9016526]
- Updated dependencies [080627f]
  - @checkstack/common@0.10.0
  - @checkstack/auth-backend@0.4.26
  - @checkstack/backend-api@0.15.2
  - @checkstack/theme-common@0.1.12

## 0.1.29

### Patch Changes

- Updated dependencies [42abfff]
  - @checkstack/common@0.9.0
  - @checkstack/auth-backend@0.4.25
  - @checkstack/backend-api@0.15.1
  - @checkstack/theme-common@0.1.11

## 0.1.28

### Patch Changes

- Updated dependencies [50e5f5f]
  - @checkstack/backend-api@0.15.0
  - @checkstack/common@0.8.0
  - @checkstack/theme-common@0.1.10
  - @checkstack/auth-backend@0.4.24

## 0.1.27

### Patch Changes

- Updated dependencies [302cd3f]
  - @checkstack/backend-api@0.14.1
  - @checkstack/auth-backend@0.4.23
  - @checkstack/common@0.7.0
  - @checkstack/theme-common@0.1.9

## 0.1.26

### Patch Changes

- 32d52c6: chore: add `drizzle-kit` as a dev dependency

  Lets each backend package run `drizzle-kit generate` locally without
  relying on the workspace-level binary. No runtime impact — devDeps
  only.

- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
  - @checkstack/backend-api@0.14.0
  - @checkstack/auth-backend@0.4.22

## 0.1.25

### Patch Changes

- @checkstack/backend-api@0.13.1
- @checkstack/auth-backend@0.4.21

## 0.1.24

### Patch Changes

- Updated dependencies [8d1ef12]
- Updated dependencies [8d1ef12]
  - @checkstack/common@0.7.0
  - @checkstack/backend-api@0.13.0
  - @checkstack/auth-backend@0.4.20
  - @checkstack/theme-common@0.1.9

## 0.1.23

### Patch Changes

- Updated dependencies [889dd8c]
  - @checkstack/auth-backend@0.4.19

## 0.1.22

### Patch Changes

- Updated dependencies [26d8bae]
  - @checkstack/backend-api@0.12.0
  - @checkstack/auth-backend@0.4.18

## 0.1.21

### Patch Changes

- Updated dependencies [d1a2796]
  - @checkstack/common@0.6.5
  - @checkstack/backend-api@0.11.1
  - @checkstack/auth-backend@0.4.17
  - @checkstack/theme-common@0.1.8

## 0.1.20

### Patch Changes

- Updated dependencies [54a5f80]
  - @checkstack/backend-api@0.11.0
  - @checkstack/auth-backend@0.4.16

## 0.1.19

### Patch Changes

- @checkstack/backend-api@0.10.1
- @checkstack/auth-backend@0.4.15

## 0.1.18

### Patch Changes

- Updated dependencies [23c80bc]
  - @checkstack/backend-api@0.10.0
  - @checkstack/auth-backend@0.4.14

## 0.1.17

### Patch Changes

- Updated dependencies [e01945b]
  - @checkstack/auth-backend@0.4.13

## 0.1.16

### Patch Changes

- Updated dependencies [c0c0ed2]
- Updated dependencies [c0c0ed2]
  - @checkstack/backend-api@0.9.0
  - @checkstack/auth-backend@0.4.12

## 0.1.15

### Patch Changes

- 67158e2: Standardize package metadata, unify AJV versions to 8.18.0, and enforce monorepo architecture rules via updated ESLint configuration. This ensures consistent package discovery and runtime dependency safety across the platform.
- b839ccb: Security: Hardened production Docker image by upgrading Alpine system libraries, migrating to Drizzle beta (v1.0.0-beta.21), and implementing aggressive binary pruning to eliminate vulnerable build-time tools (esbuild/drizzle-kit).
- Updated dependencies [67158e2]
- Updated dependencies [b839ccb]
  - @checkstack/auth-backend@0.4.11
  - @checkstack/backend-api@0.8.2
  - @checkstack/common@0.6.4
  - @checkstack/theme-common@0.1.7

## 0.1.14

### Patch Changes

- Updated dependencies [eb353a4]
  - @checkstack/auth-backend@0.4.10

## 0.1.13

### Patch Changes

- 0ebbe56: Security Vulnerability Remediation completed:
  - Refactored core authorization to Fail-Closed architecture with secure defaults.
  - Implemented `assertTeamManagementAccess` to resolve BOLA in Teams Management.
  - Protected internal S2S capabilities via explicit wildcard `serviceScope` definitions.
  - Disarmed OS Command Injection in DiskCollector via strict regex validation and bash escaping.
  - Re-architected inline script processing executing scripts in sandboxed Web Worker contexts.
  - Isolated subprocess environment scopes in PingStrategy limiting variable leakage.
  - Enforced strict token/API Key parsing with URLSearchParams checking.
  - Explicitly fail-fast on missing DATABASE_URL configuration across independent backend clusters.
  - Activated strict HTTP Security Headers (HSTS, CSP, X-Frame-Options) across the API automatically.
- Updated dependencies [0ebbe56]
  - @checkstack/auth-backend@0.4.9
  - @checkstack/backend-api@0.8.1
  - @checkstack/common@0.6.3
  - @checkstack/theme-common@0.1.6

## 0.1.12

### Patch Changes

- Updated dependencies [869b4ab]
  - @checkstack/backend-api@0.8.0
  - @checkstack/auth-backend@0.4.8

## 0.1.11

### Patch Changes

- Updated dependencies [3dd1914]
  - @checkstack/backend-api@0.7.0
  - @checkstack/auth-backend@0.4.7

## 0.1.10

### Patch Changes

- Updated dependencies [f676e11]
- Updated dependencies [48c2080]
  - @checkstack/common@0.6.2
  - @checkstack/backend-api@0.6.0
  - @checkstack/auth-backend@0.4.6
  - @checkstack/theme-common@0.1.5

## 0.1.9

### Patch Changes

- 0b9fc58: Fix workspace:\* protocol resolution in published packages

  Published packages now correctly have resolved dependency versions instead of `workspace:*` references. This is achieved by using `bun publish` which properly resolves workspace protocol references.

- Updated dependencies [0b9fc58]
  - @checkstack/auth-backend@0.4.5
  - @checkstack/backend-api@0.5.2
  - @checkstack/common@0.6.1
  - @checkstack/theme-common@0.1.4

## 0.1.8

### Patch Changes

- Updated dependencies [db1f56f]
  - @checkstack/common@0.6.0
  - @checkstack/auth-backend@0.4.4
  - @checkstack/backend-api@0.5.1
  - @checkstack/theme-common@0.1.3

## 0.1.7

### Patch Changes

- 66a3963: Update database types to use SafeDatabase

  - Updated all database type declarations from `NodePgDatabase` to `SafeDatabase` for compile-time safety

- Updated dependencies [66a3963]
- Updated dependencies [66a3963]
  - @checkstack/auth-backend@0.4.3
  - @checkstack/backend-api@0.5.0

## 0.1.6

### Patch Changes

- Updated dependencies [8a87cd4]
- Updated dependencies [8a87cd4]
  - @checkstack/backend-api@0.4.1
  - @checkstack/common@0.5.0
  - @checkstack/auth-backend@0.4.2
  - @checkstack/theme-common@0.1.2

## 0.1.5

### Patch Changes

- Updated dependencies [83557c7]
- Updated dependencies [83557c7]
  - @checkstack/backend-api@0.4.0
  - @checkstack/common@0.4.0
  - @checkstack/auth-backend@0.4.1
  - @checkstack/theme-common@0.1.1

## 0.1.4

### Patch Changes

- Updated dependencies [d94121b]
  - @checkstack/backend-api@0.3.3
  - @checkstack/auth-backend@0.4.0

## 0.1.3

### Patch Changes

- Updated dependencies [993d81a]
- Updated dependencies [df6ac7b]
  - @checkstack/auth-backend@0.3.0

## 0.1.2

### Patch Changes

- Updated dependencies [7a23261]
  - @checkstack/common@0.3.0
  - @checkstack/backend-api@0.3.2
  - @checkstack/theme-common@0.1.0
  - @checkstack/auth-backend@0.2.2

## 0.1.1

### Patch Changes

- @checkstack/backend-api@0.3.1
- @checkstack/auth-backend@0.2.1

## 0.1.0

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
- Updated dependencies [95eeec7]
- Updated dependencies [f533141]
- Updated dependencies [aa4a8ab]
  - @checkstack/auth-backend@0.2.0
  - @checkstack/backend-api@0.3.0
  - @checkstack/common@0.2.0
  - @checkstack/theme-common@0.0.5

## 0.0.4

### Patch Changes

- Updated dependencies [97c5a6b]
- Updated dependencies [8e43507]
  - @checkstack/backend-api@0.2.0
  - @checkstack/auth-backend@0.1.0
  - @checkstack/common@0.1.0
  - @checkstack/theme-common@0.0.4

## 0.0.3

### Patch Changes

- Updated dependencies [f5b1f49]
- Updated dependencies [f5b1f49]
- Updated dependencies [f5b1f49]
- Updated dependencies [f5b1f49]
  - @checkstack/auth-backend@0.0.3
  - @checkstack/backend-api@0.1.0
  - @checkstack/common@0.0.3
  - @checkstack/theme-common@0.0.3

## 0.0.2

### Patch Changes

- d20d274: Initial release of all @checkstack packages. Rebranded from Checkmate to Checkstack with new npm organization @checkstack and domain checkstack.dev.
- Updated dependencies [d20d274]
  - @checkstack/auth-backend@0.0.2
  - @checkstack/backend-api@0.0.2
  - @checkstack/common@0.0.2
  - @checkstack/theme-common@0.0.2

## 0.0.4

### Patch Changes

- Updated dependencies [b4eb432]
- Updated dependencies [a65e002]
- Updated dependencies [a65e002]
  - @checkstack/backend-api@1.1.0
  - @checkstack/common@0.2.0
  - @checkstack/auth-backend@1.1.0
  - @checkstack/theme-common@0.0.3

## 0.0.3

### Patch Changes

- @checkstack/auth-backend@1.0.1

## 0.0.2

### Patch Changes

- Updated dependencies [ffc28f6]
- Updated dependencies [71275dd]
- Updated dependencies [ae19ff6]
- Updated dependencies [32f2535]
- Updated dependencies [b55fae6]
- Updated dependencies [b354ab3]
- Updated dependencies [8e889b4]
- Updated dependencies [81f3f85]
  - @checkstack/common@0.1.0
  - @checkstack/backend-api@1.0.0
  - @checkstack/auth-backend@1.0.0
  - @checkstack/theme-common@0.0.2
