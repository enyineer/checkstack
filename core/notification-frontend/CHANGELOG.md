# @checkstack/notification-frontend

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
  - @checkstack/notification-common@0.0.4
  - @checkstack/signal-frontend@0.0.5

## 0.0.4

### Patch Changes

- Updated dependencies [f5b1f49]
- Updated dependencies [f5b1f49]
- Updated dependencies [f5b1f49]
  - @checkstack/auth-frontend@0.0.4
  - @checkstack/common@0.0.3
  - @checkstack/ui@0.0.4
  - @checkstack/frontend-api@0.0.3
  - @checkstack/notification-common@0.0.3
  - @checkstack/signal-frontend@0.0.4

## 0.0.3

### Patch Changes

- Updated dependencies [cb82e4d]
  - @checkstack/signal-frontend@0.0.3
  - @checkstack/ui@0.0.3
  - @checkstack/auth-frontend@0.0.3

## 0.0.2

### Patch Changes

- d20d274: Initial release of all @checkstack packages. Rebranded from Checkmate to Checkstack with new npm organization @checkstack and domain checkstack.dev.
- Updated dependencies [d20d274]
  - @checkstack/auth-frontend@0.0.2
  - @checkstack/common@0.0.2
  - @checkstack/frontend-api@0.0.2
  - @checkstack/notification-common@0.0.2
  - @checkstack/signal-frontend@0.0.2
  - @checkstack/ui@0.0.2

## 0.1.4

### Patch Changes

- a65e002: Add compile-time type safety for Lucide icon names

  - Add `LucideIconName` type and `lucideIconSchema` Zod schema to `@checkstack/common`
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
- Updated dependencies [a65e002]
- Updated dependencies [32ea706]
  - @checkstack/auth-frontend@0.3.0
  - @checkstack/ui@0.1.2
  - @checkstack/common@0.2.0
  - @checkstack/frontend-api@0.1.0
  - @checkstack/notification-common@0.1.1
  - @checkstack/signal-frontend@0.1.1

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

- b55fae6: Added realtime Signal Service for backend-to-frontend push notifications via WebSockets.

  ## New Packages

  - **@checkstack/signal-common**: Shared types including `Signal`, `SignalService`, `createSignal()`, and WebSocket protocol messages
  - **@checkstack/signal-backend**: `SignalServiceImpl` with EventBus integration and Bun WebSocket handler using native pub/sub
  - **@checkstack/signal-frontend**: React `SignalProvider` and `useSignal()` hook for consuming typed signals

  ## Changes

  - **@checkstack/backend-api**: Added `coreServices.signalService` reference for plugins to emit signals
  - **@checkstack/backend**: Integrated WebSocket server at `/api/signals/ws` with session-based authentication

  ## Usage

  Backend plugins can emit signals:

  ```typescript
  import { coreServices } from "@checkstack/backend-api";
  import { NOTIFICATION_RECEIVED } from "@checkstack/notification-common";

  const signalService = context.signalService;
  await signalService.sendToUser(NOTIFICATION_RECEIVED, userId, { ... });
  ```

  Frontend components subscribe to signals:

  ```tsx
  import { useSignal } from "@checkstack/signal-frontend";
  import { NOTIFICATION_RECEIVED } from "@checkstack/notification-common";

  useSignal(NOTIFICATION_RECEIVED, (payload) => {
    // Handle realtime notification
  });
  ```

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

  Added `@checkstack/notification-telegram-backend` plugin for sending notifications via Telegram:

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
- Updated dependencies [b55fae6]
- Updated dependencies [b354ab3]
  - @checkstack/ui@0.1.0
  - @checkstack/common@0.1.0
  - @checkstack/notification-common@0.1.0
  - @checkstack/auth-frontend@0.1.0
  - @checkstack/signal-frontend@0.1.0
  - @checkstack/frontend-api@0.0.2
