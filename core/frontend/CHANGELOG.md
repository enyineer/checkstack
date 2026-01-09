# @checkmate-monitor/frontend

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
  - @checkmate-monitor/auth-frontend@0.3.0
  - @checkmate-monitor/ui@0.1.2
  - @checkmate-monitor/catalog-frontend@0.1.0
  - @checkmate-monitor/common@0.2.0
  - @checkmate-monitor/command-frontend@0.1.0
  - @checkmate-monitor/frontend-api@0.1.0
  - @checkmate-monitor/signal-common@0.1.1
  - @checkmate-monitor/signal-frontend@0.1.1

## 0.1.3

### Patch Changes

- Updated dependencies [1bf71bb]
  - @checkmate-monitor/auth-frontend@0.2.1
  - @checkmate-monitor/catalog-frontend@0.0.5

## 0.1.2

### Patch Changes

- Updated dependencies [e26c08e]
  - @checkmate-monitor/auth-frontend@0.2.0
  - @checkmate-monitor/catalog-frontend@0.0.4

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
  - @checkmate-monitor/auth-frontend@0.1.1
  - @checkmate-monitor/catalog-frontend@0.0.3
  - @checkmate-monitor/command-frontend@0.0.3
  - @checkmate-monitor/ui@0.1.1

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

### Patch Changes

- Updated dependencies [eff5b4e]
- Updated dependencies [ffc28f6]
- Updated dependencies [32f2535]
- Updated dependencies [b55fae6]
- Updated dependencies [b354ab3]
  - @checkmate-monitor/ui@0.1.0
  - @checkmate-monitor/common@0.1.0
  - @checkmate-monitor/auth-frontend@0.1.0
  - @checkmate-monitor/signal-common@0.1.0
  - @checkmate-monitor/signal-frontend@0.1.0
  - @checkmate-monitor/catalog-frontend@0.0.2
  - @checkmate-monitor/command-frontend@0.0.2
  - @checkmate-monitor/frontend-api@0.0.2
