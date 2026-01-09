# @checkmate-monitor/auth-frontend

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
