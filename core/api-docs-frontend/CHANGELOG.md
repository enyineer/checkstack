# @checkmate-monitor/api-docs-frontend

## 0.0.4

### Patch Changes

- 32ea706: ### User Menu Loading State Fix

  Fixed user menu items "popping in" one after another due to independent async permission checks.

  **Changes:**

  - Added `UserMenuItemsContext` interface with `permissions` and `hasCredentialAccount` to `@checkmate-monitor/frontend-api`
  - `LoginNavbarAction` now pre-fetches all permissions and credential account info before rendering the menu
  - All user menu item components now use the passed context for synchronous permission checks instead of async hooks
  - Uses `qualifyPermissionId` helper for fully-qualified permission IDs

  **Result:** All menu items appear simultaneously when the user menu opens.

- Updated dependencies [52231ef]
- Updated dependencies [b0124ef]
- Updated dependencies [54cc787]
- Updated dependencies [a65e002]
- Updated dependencies [ae33df2]
- Updated dependencies [32ea706]
  - @checkmate-monitor/ui@0.1.2
  - @checkmate-monitor/common@0.2.0
  - @checkmate-monitor/frontend-api@0.1.0
  - @checkmate-monitor/api-docs-common@0.0.3

## 0.0.3

### Patch Changes

- Updated dependencies [0f8cc7d]
  - @checkmate-monitor/frontend-api@0.0.3
  - @checkmate-monitor/ui@0.1.1

## 0.0.2

### Patch Changes

- Updated dependencies [eff5b4e]
- Updated dependencies [ffc28f6]
- Updated dependencies [b354ab3]
  - @checkmate-monitor/ui@0.1.0
  - @checkmate-monitor/common@0.1.0
  - @checkmate-monitor/api-docs-common@0.0.2
  - @checkmate-monitor/frontend-api@0.0.2
