import { useEffect, useCallback } from "react";
import type { Signal } from "@checkmate-monitor/signal-common";
import { useSignalContext } from "./SignalProvider";

/**
 * Subscribe to a signal and receive typed payloads.
 *
 * The callback will be invoked whenever the signal is received.
 * Subscriptions are automatically cleaned up on unmount.
 *
 * @example
 * ```tsx
 * import { NOTIFICATION_RECEIVED } from "@checkmate-monitor/notification-common";
 *
 * function NotificationHandler() {
 *   useSignal(NOTIFICATION_RECEIVED, (payload) => {
 *     console.log("New notification:", payload.title);
 *   });
 *
 *   return null;
 * }
 * ```
 */
export function useSignal<T>(
  signal: Signal<T>,
  callback: (payload: T) => void
): void {
  const { subscribe } = useSignalContext();

  // Memoize callback to prevent unnecessary resubscriptions
  const stableCallback = useCallback(callback, [callback]);

  useEffect(() => {
    return subscribe(signal, stableCallback);
  }, [signal, stableCallback, subscribe]);
}

/**
 * Get the WebSocket connection status.
 *
 * @example
 * ```tsx
 * function ConnectionIndicator() {
 *   const { isConnected } = useSignalConnection();
 *
 *   return (
 *     <div className={isConnected ? "text-green-500" : "text-red-500"}>
 *       {isConnected ? "Connected" : "Disconnected"}
 *     </div>
 *   );
 * }
 * ```
 */
export function useSignalConnection(): { isConnected: boolean } {
  const { isConnected } = useSignalContext();
  return { isConnected };
}
