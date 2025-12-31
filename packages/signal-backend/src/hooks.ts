import { createHook } from "@checkmate/backend-api";
import type { SignalMessage } from "@checkmate/signal-common";

/**
 * Internal hook for broadcasting signals across backend instances.
 * All instances subscribe in broadcast mode to push to their local WebSocket clients.
 */
export const SIGNAL_BROADCAST_HOOK = createHook<SignalMessage>(
  "signal.internal.broadcast"
);

/**
 * Internal hook for user-specific signals across backend instances.
 * All instances subscribe in broadcast mode to push to the user's WebSocket connections.
 */
export const SIGNAL_USER_HOOK = createHook<{
  userId: string;
  message: SignalMessage;
}>("signal.internal.user");
