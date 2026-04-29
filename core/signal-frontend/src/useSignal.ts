import { useEffect, useRef } from "react";
import type { Signal } from "@checkstack/signal-common";
import { useSignalContext, type SignalAllCallback } from "./SignalProvider";

/**
 * Subscribe to a signal and receive typed payloads.
 *
 * The callback will be invoked whenever the signal is received.
 * Subscriptions are automatically cleaned up on unmount.
 *
 * Note: The callback is stored in a ref internally, so you don't need to
 * memoize it or worry about stale closures - the latest callback is always used.
 *
 * @example
 * ```tsx
 * import { NOTIFICATION_RECEIVED } from "@checkstack/notification-common";
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

  // Store callback in ref to always use the latest version
  // This prevents stale closure issues without requiring consumers to memoize
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    // Create a stable wrapper that always calls the latest callback
    const stableCallback = (payload: T) => {
      callbackRef.current(payload);
    };

    return subscribe(signal, stableCallback);
  }, [signal, subscribe]);
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

/**
 * Subscribe to ALL incoming signals. Used by the auto-invalidation layer.
 *
 * The callback receives `signalId`, `pluginId`, and the raw payload for every
 * signal message that arrives over the WebSocket. Subscriptions are automatically
 * cleaned up on unmount; the latest callback is always used (no stale closures).
 *
 * Component code should prefer the typed `useSignal(signal, ...)` hook over this.
 */
export function useSubscribeAllSignals(callback: SignalAllCallback): void {
  const { subscribeAll } = useSignalContext();

  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    const stableCallback: SignalAllCallback = (props) => {
      callbackRef.current(props);
    };

    return subscribeAll(stableCallback);
  }, [subscribeAll]);
}
