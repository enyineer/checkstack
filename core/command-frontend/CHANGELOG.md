# @checkstack/command-frontend

## 0.2.8

### Patch Changes

- Updated dependencies [223081d]
  - @checkstack/ui@0.5.0

## 0.2.7

### Patch Changes

- Updated dependencies [db1f56f]
- Updated dependencies [538e45d]
  - @checkstack/common@0.6.0
  - @checkstack/ui@0.4.1
  - @checkstack/command-common@0.2.3
  - @checkstack/frontend-api@0.3.3

## 0.2.6

### Patch Changes

- Updated dependencies [d1324e6]
- Updated dependencies [2c0822d]
  - @checkstack/ui@0.4.0

## 0.2.5

### Patch Changes

- Updated dependencies [8a87cd4]
  - @checkstack/common@0.5.0
  - @checkstack/command-common@0.2.2
  - @checkstack/frontend-api@0.3.2
  - @checkstack/ui@0.3.1

## 0.2.4

### Patch Changes

- Updated dependencies [83557c7]
- Updated dependencies [83557c7]
- Updated dependencies [d316128]
- Updated dependencies [6dbfab8]
  - @checkstack/ui@0.3.0
  - @checkstack/common@0.4.0
  - @checkstack/command-common@0.2.1
  - @checkstack/frontend-api@0.3.1

## 0.2.3

### Patch Changes

- Updated dependencies [d94121b]
  - @checkstack/ui@0.2.4

## 0.2.2

### Patch Changes

- Updated dependencies [f6464a2]
  - @checkstack/ui@0.2.3

## 0.2.1

### Patch Changes

- Updated dependencies [4eed42d]
  - @checkstack/frontend-api@0.3.0
  - @checkstack/ui@0.2.2

## 0.2.0

### Minor Changes

- 7a23261: ## TanStack Query Integration

  Migrated all frontend components to use `usePluginClient` hook with TanStack Query integration, replacing the legacy `forPlugin()` pattern.

  ### New Features

  - **`usePluginClient` hook**: Provides type-safe access to plugin APIs with `.useQuery()` and `.useMutation()` methods
  - **Automatic request deduplication**: Multiple components requesting the same data share a single network request
  - **Built-in caching**: Configurable stale time and cache duration per query
  - **Loading/error states**: TanStack Query provides `isLoading`, `error`, `isRefetching` states automatically
  - **Background refetching**: Stale data is automatically refreshed when components mount

  ### Contract Changes

  All RPC contracts now require `operationType: "query"` or `operationType: "mutation"` metadata:

  ```typescript
  const getItems = proc()
    .meta({ operationType: "query", access: [access.read] })
    .output(z.array(itemSchema))
    .query();

  const createItem = proc()
    .meta({ operationType: "mutation", access: [access.manage] })
    .input(createItemSchema)
    .output(itemSchema)
    .mutation();
  ```

  ### Migration

  ```typescript
  // Before (forPlugin pattern)
  const api = useApi(myPluginApiRef);
  const [items, setItems] = useState<Item[]>([]);
  useEffect(() => {
    api.getItems().then(setItems);
  }, [api]);

  // After (usePluginClient pattern)
  const client = usePluginClient(MyPluginApi);
  const { data: items, isLoading } = client.getItems.useQuery({});
  ```

  ### Bug Fixes

  - Fixed `rpc.test.ts` test setup for middleware type inference
  - Fixed `SearchDialog` to use `setQuery` instead of deprecated `search` method
  - Fixed null→undefined warnings in notification and queue frontends

### Patch Changes

- Updated dependencies [7a23261]
  - @checkstack/frontend-api@0.2.0
  - @checkstack/common@0.3.0
  - @checkstack/command-common@0.2.0
  - @checkstack/ui@0.2.1

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
- Updated dependencies [f533141]
  - @checkstack/command-common@0.1.0
  - @checkstack/common@0.2.0
  - @checkstack/frontend-api@0.1.0
  - @checkstack/ui@0.2.0

## 0.0.5

### Patch Changes

- 97c5a6b: Fix Radix UI accessibility warning in dialog components by adding visually hidden DialogDescription components
- Updated dependencies [8e43507]
- Updated dependencies [97c5a6b]
- Updated dependencies [8e43507]
  - @checkstack/ui@0.1.0
  - @checkstack/common@0.1.0
  - @checkstack/command-common@0.0.4
  - @checkstack/frontend-api@0.0.4

## 0.0.4

### Patch Changes

- Updated dependencies [f5b1f49]
- Updated dependencies [f5b1f49]
  - @checkstack/common@0.0.3
  - @checkstack/ui@0.0.4
  - @checkstack/command-common@0.0.3
  - @checkstack/frontend-api@0.0.3

## 0.0.3

### Patch Changes

- Updated dependencies [cb82e4d]
  - @checkstack/ui@0.0.3

## 0.0.2

### Patch Changes

- d20d274: Initial release of all @checkstack packages. Rebranded from Checkmate to Checkstack with new npm organization @checkstack and domain checkstack.dev.
- Updated dependencies [d20d274]
  - @checkstack/command-common@0.0.2
  - @checkstack/common@0.0.2
  - @checkstack/frontend-api@0.0.2
  - @checkstack/ui@0.0.2

## 0.1.0

### Minor Changes

- ae33df2: Move command palette from dashboard to centered navbar position

  - Converted `command-frontend` into a plugin with `NavbarCenterSlot` extension
  - Added compact `NavbarSearch` component with responsive search trigger
  - Moved `SearchDialog` from dashboard-frontend to command-frontend
  - Keyboard shortcut (⌘K / Ctrl+K) now works on every page
  - Renamed navbar slots for clarity:
    - `NavbarSlot` → `NavbarRightSlot`
    - `NavbarMainSlot` → `NavbarLeftSlot`
    - Added new `NavbarCenterSlot` for centered content

### Patch Changes

- Updated dependencies [52231ef]
- Updated dependencies [b0124ef]
- Updated dependencies [54cc787]
- Updated dependencies [a65e002]
- Updated dependencies [ae33df2]
- Updated dependencies [32ea706]
  - @checkstack/ui@0.1.2
  - @checkstack/common@0.2.0
  - @checkstack/frontend-api@0.1.0
  - @checkstack/command-common@0.0.3

## 0.0.3

### Patch Changes

- Updated dependencies [0f8cc7d]
  - @checkstack/frontend-api@0.0.3

## 0.0.2

### Patch Changes

- Updated dependencies [ffc28f6]
  - @checkstack/common@0.1.0
  - @checkstack/command-common@0.0.2
  - @checkstack/frontend-api@0.0.2
