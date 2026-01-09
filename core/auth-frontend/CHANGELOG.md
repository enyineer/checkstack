# @checkmate-monitor/auth-frontend

## 0.3.0

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

- 32ea706: ### User Menu Loading State Fix

  Fixed user menu items "popping in" one after another due to independent async permission checks.

  **Changes:**

  - Added `UserMenuItemsContext` interface with `permissions` and `hasCredentialAccount` to `@checkmate-monitor/frontend-api`
  - `LoginNavbarAction` now pre-fetches all permissions and credential account info before rendering the menu
  - All user menu item components now use the passed context for synchronous permission checks instead of async hooks
  - Uses `qualifyPermissionId` helper for fully-qualified permission IDs

  **Result:** All menu items appear simultaneously when the user menu opens.

### Patch Changes

- 54cc787: ### Fix Access Denied Flash on Page Load

  Fixed the "Access Denied" screen briefly flashing when loading permission-protected pages.

  **Root cause:** The `usePermissions` hook was setting `loading: false` when the session was still pending, causing a brief moment where permissions appeared to be denied.

  **Changes:**

  - `usePermissions` hook now waits for session to finish loading (`isPending`) before determining permission state
  - `PageLayout` component now treats `loading=undefined` with `allowed=false` as a loading state
  - `AuthSettingsPage` now explicitly waits for permission hooks to finish loading before checking access

  **Result:** Pages show a loading spinner until permissions are fully resolved, eliminating the flash.

- a65e002: Add compile-time type safety for Lucide icon names

  - Add `LucideIconName` type and `lucideIconSchema` Zod schema to `@checkmate-monitor/common`
  - Update backend interfaces (`AuthStrategy`, `NotificationStrategy`, `IntegrationProvider`, `CommandDefinition`) to use `LucideIconName`
  - Update RPC contracts to use `lucideIconSchema` for proper type inference across RPC boundaries
  - Simplify `SocialProviderButton` to use `DynamicIcon` directly (removes 30+ lines of pascalCase conversion)
  - Replace static `iconMap` in `SearchDialog` with `DynamicIcon` for dynamic icon rendering
  - Add fallback handling in `DynamicIcon` when icon name isn't found
  - Fix legacy kebab-case icon names to PascalCase: `mail`→`Mail`, `send`→`Send`, `github`→`Github`, `key-round`→`KeyRound`, `network`→`Network`, `AlertCircle`→`CircleAlert`

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
- Updated dependencies [32ea706]
  - @checkmate-monitor/ui@0.1.2
  - @checkmate-monitor/common@0.2.0
  - @checkmate-monitor/auth-common@0.2.1
  - @checkmate-monitor/frontend-api@0.1.0

## 0.2.1

### Patch Changes

- 1bf71bb: Hide "Change Password" menu item for non-credential users

  The change password feature now only appears in the user menu for users who have
  a credential-based account (email/password). Users who authenticated exclusively
  via OAuth providers (e.g., GitHub, Google) will no longer see this option since
  they don't have a password to change.

## 0.2.0

### Minor Changes

- e26c08e: Add password change functionality for credential-authenticated users

  - Add `changePassword` route to auth-common
  - Create `ChangePasswordPage.tsx` component with password validation, current password verification, and session revocation option
  - Add "Change Password" menu item in User Menu
  - Reuses patterns from existing password reset flow for consistency

### Patch Changes

- Updated dependencies [e26c08e]
  - @checkmate-monitor/auth-common@0.2.0

## 0.1.1

### Patch Changes

- 0f8cc7d: Add runtime configuration API for Docker deployments

  - Backend: Add `/api/config` endpoint serving `BASE_URL` at runtime
  - Backend: Update CORS to use `BASE_URL` and auto-allow Vite dev server
  - Backend: `INTERNAL_URL` now defaults to `localhost:3000` (no BASE_URL fallback)
  - Frontend API: Add `RuntimeConfigProvider` context for runtime config
  - Frontend: Use `RuntimeConfigProvider` from `frontend-api`
  - Auth Frontend: Add `useAuthClient()` hook using runtime config

- Updated dependencies [0f8cc7d]
  - @checkmate-monitor/frontend-api@0.0.3
  - @checkmate-monitor/ui@0.1.1

## 0.1.0

### Minor Changes

- 32f2535: Refactor application role assignment

  - Removed role selection from the application creation dialog
  - New applications now automatically receive the "Applications" role
  - Roles are now manageable inline in the Applications table (similar to user role management)
  - Added informational alert in create dialog explaining default role behavior

- b354ab3: # Strategy Instructions Support & Telegram Notification Plugin

  ## Strategy Instructions Interface

  Added `adminInstructions` and `userInstructions` optional fields to the `NotificationStrategy` interface. These allow strategies to export markdown-formatted setup guides that are displayed in the configuration UI:

  - **`adminInstructions`**: Shown when admins configure platform-wide strategy settings (e.g., how to create API keys)
  - **`userInstructions`**: Shown when users configure their personal settings (e.g., how to link their account)

  ### Updated Components

  - `StrategyConfigCard` now accepts an `instructions` prop and renders it before config sections
  - `StrategyCard` passes `adminInstructions` to `StrategyConfigCard`
  - `UserChannelCard` renders `userInstructions` when users need to connect

  ## New Telegram Notification Plugin

  Added `@checkmate-monitor/notification-telegram-backend` plugin for sending notifications via Telegram:

  - Uses [grammY](https://grammy.dev/) framework for Telegram Bot API integration
  - Sends messages with MarkdownV2 formatting and inline keyboard buttons for actions
  - Includes comprehensive admin instructions for bot setup via @BotFather
  - Includes user instructions for account linking

  ### Configuration

  Admins need to configure a Telegram Bot Token obtained from @BotFather.

  ### User Linking

  The strategy uses `contactResolution: { type: "custom" }` for Telegram Login Widget integration. Full frontend integration for the Login Widget is pending future work.

### Patch Changes

- Updated dependencies [eff5b4e]
- Updated dependencies [ffc28f6]
- Updated dependencies [32f2535]
- Updated dependencies [b354ab3]
  - @checkmate-monitor/ui@0.1.0
  - @checkmate-monitor/common@0.1.0
  - @checkmate-monitor/auth-common@0.1.0
  - @checkmate-monitor/frontend-api@0.0.2
