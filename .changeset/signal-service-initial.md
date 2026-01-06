---
"@checkmate-monitor/signal-common": minor
"@checkmate-monitor/signal-backend": minor
"@checkmate-monitor/signal-frontend": minor
"@checkmate-monitor/backend-api": minor
"@checkmate-monitor/backend": minor
"@checkmate-monitor/frontend": minor
"@checkmate-monitor/notification-common": minor
"@checkmate-monitor/notification-backend": minor
"@checkmate-monitor/notification-frontend": minor
"@checkmate-monitor/test-utils-backend": minor
---

Added realtime Signal Service for backend-to-frontend push notifications via WebSockets.

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
