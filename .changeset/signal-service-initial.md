---
"@checkmate/signal-common": minor
"@checkmate/signal-backend": minor
"@checkmate/signal-frontend": minor
"@checkmate/backend-api": minor
"@checkmate/backend": minor
"@checkmate/frontend": minor
"@checkmate/notification-common": minor
"@checkmate/notification-backend": minor
"@checkmate/notification-frontend": minor
---

Added realtime Signal Service for backend-to-frontend push notifications via WebSockets.

## New Packages

- **@checkmate/signal-common**: Shared types including `Signal`, `SignalService`, `createSignal()`, and WebSocket protocol messages
- **@checkmate/signal-backend**: `SignalServiceImpl` with EventBus integration and Bun WebSocket handler using native pub/sub
- **@checkmate/signal-frontend**: React `SignalProvider` and `useSignal()` hook for consuming typed signals

## Changes

- **@checkmate/backend-api**: Added `coreServices.signalService` reference for plugins to emit signals
- **@checkmate/backend**: Integrated WebSocket server at `/api/signals/ws` with session-based authentication

## Usage

Backend plugins can emit signals:
```typescript
import { coreServices } from "@checkmate/backend-api";
import { NOTIFICATION_RECEIVED } from "@checkmate/notification-common";

const signalService = context.signalService;
await signalService.sendToUser(NOTIFICATION_RECEIVED, userId, { ... });
```

Frontend components subscribe to signals:
```tsx
import { useSignal } from "@checkmate/signal-frontend";
import { NOTIFICATION_RECEIVED } from "@checkmate/notification-common";

useSignal(NOTIFICATION_RECEIVED, (payload) => {
  // Handle realtime notification
});
```
