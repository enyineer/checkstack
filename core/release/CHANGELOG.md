# @checkstack/release

## 0.3.0

### Minor Changes

- f5b1f49: Updated frontend URL environment variable from `VITE_FRONTEND_URL` to `BASE_URL` for consistency.

## 0.2.0

### Minor Changes

- cb82e4d: Improved `counter` and `pie` auto-chart types to show frequency distributions instead of just the latest value. Both chart types now count occurrences of each unique value across all runs/buckets, making them more intuitive for visualizing data like HTTP status codes.

  Changed HTTP health check chart annotations: `statusCode` now uses `pie` chart (distribution view), `contentType` now uses `counter` chart (frequency count).

  Fixed scrollbar hopping when health check signals update the accordion content. All charts now update silently without layout shift or loading state flicker.

  Refactored health check visualization architecture:

  - `HealthCheckStatusTimeline` and `HealthCheckLatencyChart` now accept `HealthCheckDiagramSlotContext` directly, handling data transformation internally
  - `HealthCheckDiagram` refactored to accept context from parent, ensuring all visualizations share the same data source and update together on signals
  - `HealthCheckSystemOverview` simplified to use `useHealthCheckData` hook for consolidated data fetching with automatic signal-driven refresh

  Added `silentRefetch()` method to `usePagination` hook for background data refreshes without showing loading indicators.

  Fixed `useSignal` hook to use a ref pattern internally, preventing stale closure issues. Callbacks now always access the latest values without requiring manual memoization or refs in consumer components.

  Added signal handling to `useHealthCheckData` hook for automatic chart refresh when health check runs complete.

## 0.1.0

### Minor Changes

- d20d274: Initial release of all @checkstack packages. Rebranded from Checkmate to Checkstack with new npm organization @checkstack and domain checkstack.dev.

## 0.5.0

### Minor Changes

- 52231ef: # Auth Settings Page Refactoring

  ## Auth Frontend

  Refactored the `AuthSettingsPage` into modular, self-contained tab components:

  - **New Components**: Created `UsersTab`, `RolesTab`, `StrategiesTab`, and `ApplicationsTab` components
  - **Dynamic Tab Visibility**: Tabs are now conditionally shown based on user permissions
  - **Auto-Select Logic**: Automatically selects the first available tab if the current tab becomes inaccessible
  - **Self-Contained State**: Each tab component manages its own state, handlers, and dialogs, reducing prop drilling

  ## UI Package

  - **Responsive Tabs**: Tabs now use column layout on small screens and row layout on medium+ screens

## 0.4.0

### Minor Changes

- 1bf71bb: Hide "Change Password" menu item for non-credential users

  The change password feature now only appears in the user menu for users who have
  a credential-based account (email/password). Users who authenticated exclusively
  via OAuth providers (e.g., GitHub, Google) will no longer see this option since
  they don't have a password to change.

## 0.3.0

### Minor Changes

- e26c08e: Add password change functionality for credential-authenticated users

  - Add `changePassword` route to auth-common
  - Create `ChangePasswordPage.tsx` component with password validation, current password verification, and session revocation option
  - Add "Change Password" menu item in User Menu
  - Reuses patterns from existing password reset flow for consistency

## 0.2.0

### Minor Changes

- 0f8cc7d: Add runtime configuration API for Docker deployments

  - Backend: Add `/api/config` endpoint serving `BASE_URL` at runtime
  - Backend: Update CORS to use `BASE_URL` and auto-allow Vite dev server
  - Backend: `INTERNAL_URL` now defaults to `localhost:3000` (no BASE_URL fallback)
  - Frontend API: Add `RuntimeConfigProvider` context for runtime config
  - Frontend: Use `RuntimeConfigProvider` from `frontend-api`
  - Auth Frontend: Add `useAuthClient()` hook using runtime config
