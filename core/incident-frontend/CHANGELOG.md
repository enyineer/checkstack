# @checkstack/incident-frontend

## 0.0.2

### Patch Changes

- d20d274: Initial release of all @checkstack packages. Rebranded from Checkmate to Checkstack with new npm organization @checkstack and domain checkstack.dev.
- Updated dependencies [d20d274]
  - @checkstack/catalog-common@0.0.2
  - @checkstack/common@0.0.2
  - @checkstack/frontend-api@0.0.2
  - @checkstack/incident-common@0.0.2
  - @checkstack/signal-frontend@0.0.2
  - @checkstack/ui@0.0.2

## 0.0.4

### Patch Changes

- 97a6a23: Improve incident and maintenance detail page layout consistency and navigation

  **Layout consistency:**

  - Incident detail page now matches maintenance detail page structure
  - Both use PageLayout wrapper with consistent card layout
  - Affected systems moved into main details card with server icons
  - Standardized padding, spacing, and description/date formatting

  **Back navigation with system context:**

  - Detail pages now track source system via `?from=systemId` query parameter
  - "Back to History" navigates to the correct system's history page
  - Works when navigating from system panels, history pages, or system detail page
  - Falls back to first affected system if no query param present

- 32ea706: ### User Menu Loading State Fix

  Fixed user menu items "popping in" one after another due to independent async permission checks.

  **Changes:**

  - Added `UserMenuItemsContext` interface with `permissions` and `hasCredentialAccount` to `@checkstack/frontend-api`
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
  - @checkstack/ui@0.1.2
  - @checkstack/common@0.2.0
  - @checkstack/frontend-api@0.1.0
  - @checkstack/catalog-common@0.1.2
  - @checkstack/incident-common@0.1.2
  - @checkstack/signal-frontend@0.1.1

## 0.0.3

### Patch Changes

- Updated dependencies [0f8cc7d]
  - @checkstack/frontend-api@0.0.3
  - @checkstack/catalog-common@0.1.1
  - @checkstack/incident-common@0.1.1
  - @checkstack/ui@0.1.1

## 0.0.2

### Patch Changes

- Updated dependencies [eff5b4e]
- Updated dependencies [ffc28f6]
- Updated dependencies [4dd644d]
- Updated dependencies [b55fae6]
- Updated dependencies [b354ab3]
  - @checkstack/ui@0.1.0
  - @checkstack/common@0.1.0
  - @checkstack/catalog-common@0.1.0
  - @checkstack/incident-common@0.1.0
  - @checkstack/signal-frontend@0.1.0
  - @checkstack/frontend-api@0.0.2
