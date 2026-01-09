# @checkmate-monitor/notification-backend

## 0.1.2

### Patch Changes

- b4eb432: Fixed TypeScript generic contravariance issue in notification strategy registration.

  The `register` and `addStrategy` methods now use generic type parameters instead of `unknown`, allowing notification strategy plugins with typed OAuth configurations to be registered without compiler errors. This fixes contravariance issues where function parameters in `StrategyOAuthConfig<TConfig>` could not be assigned when `TConfig` was a specific type.

- Updated dependencies [b4eb432]
- Updated dependencies [a65e002]
- Updated dependencies [a65e002]
  - @checkmate-monitor/backend-api@1.1.0
  - @checkmate-monitor/common@0.2.0
  - @checkmate-monitor/auth-common@0.2.1
  - @checkmate-monitor/auth-backend@1.1.0
  - @checkmate-monitor/queue-api@1.0.1
  - @checkmate-monitor/notification-common@0.1.1
  - @checkmate-monitor/signal-common@0.1.1

## 0.1.1

### Patch Changes

- Updated dependencies [e26c08e]
  - @checkmate-monitor/auth-common@0.2.0
  - @checkmate-monitor/auth-backend@1.0.1

## 0.1.0

### Minor Changes

- b55fae6: Added realtime Signal Service for backend-to-frontend push notifications via WebSockets.

  ## New Packages

  - **@checkmate-monitor/signal-common**: Shared types including `Signal`, `SignalService`, `createSignal()`, and WebSocket protocol messages
  - **@checkmate-monitor/signal-backend**: `SignalServiceImpl` with EventBus integration and Bun WebSocket handler using native pub/sub
  - **@checkmate-monitor/signal-frontend**: React `SignalProvider` and `useSignal()` hook for consuming typed signals

  ## Changes

  - **@checkmate-monitor/backend-api**: Added `coreServices.signalService` reference for plugins to emit signals
  - **@checkmate-monitor/backend**: Integrated WebSocket server at `/api/signals/ws` with session-based authentication

  ## Usage

  Backend plugins can emit signals:

  ```typescript
  import { coreServices } from "@checkmate-monitor/backend-api";
  import { NOTIFICATION_RECEIVED } from "@checkmate-monitor/notification-common";

  const signalService = context.signalService;
  await signalService.sendToUser(NOTIFICATION_RECEIVED, userId, { ... });
  ```

  Frontend components subscribe to signals:

  ```tsx
  import { useSignal } from "@checkmate-monitor/signal-frontend";
  import { NOTIFICATION_RECEIVED } from "@checkmate-monitor/notification-common";

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

- Updated dependencies [ffc28f6]
- Updated dependencies [e4d83fc]
- Updated dependencies [71275dd]
- Updated dependencies [ae19ff6]
- Updated dependencies [32f2535]
- Updated dependencies [b55fae6]
- Updated dependencies [b354ab3]
- Updated dependencies [8e889b4]
- Updated dependencies [81f3f85]
  - @checkmate-monitor/common@0.1.0
  - @checkmate-monitor/backend-api@1.0.0
  - @checkmate-monitor/auth-backend@1.0.0
  - @checkmate-monitor/auth-common@0.1.0
  - @checkmate-monitor/notification-common@0.1.0
  - @checkmate-monitor/queue-api@1.0.0
  - @checkmate-monitor/signal-common@0.1.0
