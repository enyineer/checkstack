# @checkstack/theme-frontend

## 0.1.14

### Patch Changes

- Updated dependencies [c842373]
  - @checkstack/ui@1.1.0
  - @checkstack/auth-frontend@0.5.10

## 0.1.13

### Patch Changes

- Updated dependencies [f676e11]
  - @checkstack/ui@1.0.0
  - @checkstack/common@0.6.2
  - @checkstack/auth-frontend@0.5.9
  - @checkstack/frontend-api@0.3.5
  - @checkstack/theme-common@0.1.5

## 0.1.12

### Patch Changes

- Updated dependencies [e5079e1]
- Updated dependencies [9551fd7]
  - @checkstack/ui@0.5.3
  - @checkstack/auth-frontend@0.5.8

## 0.1.11

### Patch Changes

- 0b9fc58: Fix workspace:\* protocol resolution in published packages

  Published packages now correctly have resolved dependency versions instead of `workspace:*` references. This is achieved by using `bun publish` which properly resolves workspace protocol references.

- Updated dependencies [0b9fc58]
  - @checkstack/auth-frontend@0.5.7
  - @checkstack/common@0.6.1
  - @checkstack/frontend-api@0.3.4
  - @checkstack/theme-common@0.1.4
  - @checkstack/ui@0.5.2

## 0.1.10

### Patch Changes

- Updated dependencies [090143b]
  - @checkstack/ui@0.5.1
  - @checkstack/auth-frontend@0.5.6

## 0.1.9

### Patch Changes

- Updated dependencies [223081d]
  - @checkstack/ui@0.5.0
  - @checkstack/auth-frontend@0.5.5

## 0.1.8

### Patch Changes

- Updated dependencies [db1f56f]
- Updated dependencies [538e45d]
  - @checkstack/common@0.6.0
  - @checkstack/ui@0.4.1
  - @checkstack/auth-frontend@0.5.4
  - @checkstack/frontend-api@0.3.3
  - @checkstack/theme-common@0.1.3

## 0.1.7

### Patch Changes

- Updated dependencies [d1324e6]
- Updated dependencies [2c0822d]
  - @checkstack/ui@0.4.0
  - @checkstack/auth-frontend@0.5.3

## 0.1.6

### Patch Changes

- Updated dependencies [8a87cd4]
  - @checkstack/common@0.5.0
  - @checkstack/auth-frontend@0.5.2
  - @checkstack/frontend-api@0.3.2
  - @checkstack/theme-common@0.1.2
  - @checkstack/ui@0.3.1

## 0.1.5

### Patch Changes

- Updated dependencies [83557c7]
- Updated dependencies [83557c7]
- Updated dependencies [d316128]
- Updated dependencies [6dbfab8]
  - @checkstack/ui@0.3.0
  - @checkstack/common@0.4.0
  - @checkstack/auth-frontend@0.5.1
  - @checkstack/frontend-api@0.3.1
  - @checkstack/theme-common@0.1.1

## 0.1.4

### Patch Changes

- Updated dependencies [10aa9fb]
- Updated dependencies [d94121b]
  - @checkstack/auth-frontend@0.5.0
  - @checkstack/ui@0.2.4

## 0.1.3

### Patch Changes

- f6464a2: Fix theme toggle showing incorrect state when system theme is used

  - Added `resolvedTheme` property to `ThemeProvider` that returns the actual computed theme ("light" or "dark"), resolving "system" to the user's OS preference
  - Updated `NavbarThemeToggle` and `ThemeToggleMenuItem` to use `resolvedTheme` instead of `theme` for determining toggle state
  - Changed default theme from "light" to "system" so non-logged-in users respect their OS color scheme preference

- Updated dependencies [f6464a2]
  - @checkstack/ui@0.2.3
  - @checkstack/auth-frontend@0.4.1

## 0.1.2

### Patch Changes

- Updated dependencies [df6ac7b]
  - @checkstack/auth-frontend@0.4.0

## 0.1.1

### Patch Changes

- Updated dependencies [4eed42d]
  - @checkstack/frontend-api@0.3.0
  - @checkstack/auth-frontend@0.3.1
  - @checkstack/ui@0.2.2

## 0.1.0

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
  - @checkstack/auth-frontend@0.3.0
  - @checkstack/theme-common@0.1.0
  - @checkstack/ui@0.2.1

## 0.0.6

### Patch Changes

- Updated dependencies [9faec1f]
- Updated dependencies [95eeec7]
- Updated dependencies [f533141]
  - @checkstack/auth-frontend@0.2.0
  - @checkstack/common@0.2.0
  - @checkstack/frontend-api@0.1.0
  - @checkstack/ui@0.2.0
  - @checkstack/theme-common@0.0.5

## 0.0.5

### Patch Changes

- Updated dependencies [8e43507]
- Updated dependencies [97c5a6b]
- Updated dependencies [97c5a6b]
- Updated dependencies [8e43507]
  - @checkstack/ui@0.1.0
  - @checkstack/auth-frontend@0.1.0
  - @checkstack/common@0.1.0
  - @checkstack/frontend-api@0.0.4
  - @checkstack/theme-common@0.0.4

## 0.0.4

### Patch Changes

- Updated dependencies [f5b1f49]
- Updated dependencies [f5b1f49]
- Updated dependencies [f5b1f49]
  - @checkstack/auth-frontend@0.0.4
  - @checkstack/common@0.0.3
  - @checkstack/ui@0.0.4
  - @checkstack/frontend-api@0.0.3
  - @checkstack/theme-common@0.0.3

## 0.0.3

### Patch Changes

- Updated dependencies [cb82e4d]
  - @checkstack/ui@0.0.3
  - @checkstack/auth-frontend@0.0.3

## 0.0.2

### Patch Changes

- d20d274: Initial release of all @checkstack packages. Rebranded from Checkmate to Checkstack with new npm organization @checkstack and domain checkstack.dev.
- Updated dependencies [d20d274]
  - @checkstack/auth-frontend@0.0.2
  - @checkstack/common@0.0.2
  - @checkstack/frontend-api@0.0.2
  - @checkstack/theme-common@0.0.2
  - @checkstack/ui@0.0.2

## 0.1.4

### Patch Changes

- ae33df2: Move command palette from dashboard to centered navbar position

  - Converted `command-frontend` into a plugin with `NavbarCenterSlot` extension
  - Added compact `NavbarSearch` component with responsive search trigger
  - Moved `SearchDialog` from dashboard-frontend to command-frontend
  - Keyboard shortcut (⌘K / Ctrl+K) now works on every page
  - Renamed navbar slots for clarity:
    - `NavbarSlot` → `NavbarRightSlot`
    - `NavbarMainSlot` → `NavbarLeftSlot`
    - Added new `NavbarCenterSlot` for centered content

- Updated dependencies [52231ef]
- Updated dependencies [b0124ef]
- Updated dependencies [54cc787]
- Updated dependencies [a65e002]
- Updated dependencies [ae33df2]
- Updated dependencies [a65e002]
- Updated dependencies [32ea706]
  - @checkstack/auth-frontend@0.3.0
  - @checkstack/ui@0.1.2
  - @checkstack/common@0.2.0
  - @checkstack/frontend-api@0.1.0
  - @checkstack/theme-common@0.0.3

## 0.1.3

### Patch Changes

- Updated dependencies [1bf71bb]
  - @checkstack/auth-frontend@0.2.1

## 0.1.2

### Patch Changes

- Updated dependencies [e26c08e]
  - @checkstack/auth-frontend@0.2.0

## 0.1.1

### Patch Changes

- Updated dependencies [0f8cc7d]
  - @checkstack/frontend-api@0.0.3
  - @checkstack/auth-frontend@0.1.1
  - @checkstack/ui@0.1.1

## 0.1.0

### Minor Changes

- d673ab4: Add theme persistence for non-logged-in users via local storage

  - Added `NavbarThemeToggle` component that shows a Sun/Moon button in the navbar for non-logged-in users
  - Added `ThemeSynchronizer` component that loads theme from backend for logged-in users on page load
  - Theme is now applied immediately on page load for logged-in users (no need to open user menu first)
  - Non-logged-in users can now toggle theme, which persists in local storage
  - Logged-in user's backend-saved theme takes precedence over local storage

### Patch Changes

- Updated dependencies [eff5b4e]
- Updated dependencies [ffc28f6]
- Updated dependencies [32f2535]
- Updated dependencies [b354ab3]
  - @checkstack/ui@0.1.0
  - @checkstack/common@0.1.0
  - @checkstack/auth-frontend@0.1.0
  - @checkstack/frontend-api@0.0.2
  - @checkstack/theme-common@0.0.2
