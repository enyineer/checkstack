import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
} from "react";
import type {
  Signal,
  ServerToClientMessage,
} from "@checkstack/signal-common";

// =============================================================================
// CONTEXT TYPES
// =============================================================================

/**
 * Wildcard subscription callback. Fires for every incoming signal message
 * regardless of signalId, with the pluginId already extracted from the wire envelope.
 * Used by the auto-invalidation layer; not intended for component-level use.
 */
export type SignalAllCallback = (props: {
  signalId: string;
  pluginId: string;
  payload: unknown;
}) => void;

interface SignalContextValue {
  /** Whether the WebSocket connection is established */
  isConnected: boolean;
  /** Subscribe to a specific signal. Returns an unsubscribe function. */
  subscribe<T>(signal: Signal<T>, callback: (payload: T) => void): () => void;
  /**
   * Subscribe to ALL incoming signals. Returns an unsubscribe function.
   * Used by the auto-invalidation layer to receive every message.
   */
  subscribeAll(callback: SignalAllCallback): () => void;
}

const SignalContext = createContext<SignalContextValue | undefined>(undefined);

// =============================================================================
// SIGNAL PROVIDER
// =============================================================================

interface SignalProviderProps {
  children: React.ReactNode;
  /** Backend URL (defaults to VITE_BACKEND_URL environment variable) */
  backendUrl?: string;
}

/**
 * Provider component that manages the WebSocket connection for signals.
 *
 * Should be rendered inside AuthProvider, and only when a user is authenticated.
 *
 * @example
 * ```tsx
 * // In your app layout (only render when authenticated)
 * {user && (
 *   <SignalProvider>
 *     <AuthenticatedContent />
 *   </SignalProvider>
 * )}
 * ```
 */
export const SignalProvider: React.FC<SignalProviderProps> = ({
  children,
  backendUrl,
}) => {
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | undefined>(undefined);
  const listenersRef = useRef<Map<string, Set<(payload: unknown) => void>>>(
    new Map()
  );
  const allListenersRef = useRef<Set<SignalAllCallback>>(new Set());
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  );
  const reconnectAttemptsRef = useRef(0);

  useEffect(() => {
    // Determine WebSocket URL - use provided backendUrl or VITE_API_BASE_URL
    const baseUrl = backendUrl ?? import.meta.env.VITE_API_BASE_URL;

    if (!baseUrl) {
      console.warn(
        "SignalProvider: No backend URL configured. WebSocket connection disabled."
      );
      return;
    }

    const wsUrl = baseUrl.replace(/^http/, "ws") + "/api/signals/ws";

    const connect = () => {
      if (wsRef.current?.readyState === WebSocket.OPEN) return;

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.addEventListener("open", () => {
        setIsConnected(true);
        reconnectAttemptsRef.current = 0;
      });

      ws.addEventListener("close", () => {
        setIsConnected(false);

        // Reconnect with exponential backoff
        const delay = Math.min(
          1000 * Math.pow(2, reconnectAttemptsRef.current),
          30_000
        );
        reconnectAttemptsRef.current++;

        reconnectTimeoutRef.current = setTimeout(connect, delay);
      });

      ws.addEventListener("error", (event) => {
        console.error("SignalProvider: WebSocket error", event);
      });

      ws.addEventListener("message", (event: MessageEvent<string>) => {
        try {
          const message: ServerToClientMessage = JSON.parse(event.data);

          if (message.type === "signal") {
            const listeners = listenersRef.current.get(message.signalId);
            if (listeners) {
              for (const callback of listeners) {
                callback(message.payload);
              }
            }
            // Notify wildcard listeners (auto-invalidator etc.)
            for (const callback of allListenersRef.current) {
              callback({
                signalId: message.signalId,
                pluginId: message.pluginId,
                payload: message.payload,
              });
            }
          }
          // Ignore "connected" and "pong" messages
        } catch (error) {
          console.error("SignalProvider: Failed to parse message", error);
        }
      });
    };

    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      wsRef.current?.close();
    };
  }, [backendUrl]);

  const subscribe = useCallback(
    <T,>(signal: Signal<T>, callback: (payload: T) => void) => {
      const signalId = signal.id;

      if (!listenersRef.current.has(signalId)) {
        listenersRef.current.set(signalId, new Set());
      }
      listenersRef.current
        .get(signalId)!
        .add(callback as (payload: unknown) => void);

      // Return unsubscribe function
      return () => {
        listenersRef.current
          .get(signalId)
          ?.delete(callback as (payload: unknown) => void);
      };
    },
    []
  );

  const subscribeAll = useCallback((callback: SignalAllCallback) => {
    allListenersRef.current.add(callback);
    return () => {
      allListenersRef.current.delete(callback);
    };
  }, []);

  const value: SignalContextValue = {
    isConnected,
    subscribe,
    subscribeAll,
  };

  return (
    <SignalContext.Provider value={value}>{children}</SignalContext.Provider>
  );
};

// =============================================================================
// CONTEXT HOOK
// =============================================================================

/**
 * Access the SignalContext. Must be used within a SignalProvider.
 */
export const useSignalContext = () => {
  const context = useContext(SignalContext);
  if (!context) {
    throw new Error("useSignalContext must be used within a SignalProvider");
  }
  return context;
};
