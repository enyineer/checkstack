import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
} from "react";
import type { Signal, ServerToClientMessage } from "@checkmate/signal-common";

// =============================================================================
// CONTEXT TYPES
// =============================================================================

interface SignalContextValue {
  /** Whether the WebSocket connection is established */
  isConnected: boolean;
  /** Subscribe to a signal. Returns an unsubscribe function. */
  subscribe<T>(signal: Signal<T>, callback: (payload: T) => void): () => void;
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
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  );
  const reconnectAttemptsRef = useRef(0);

  useEffect(() => {
    // Determine WebSocket URL - use provided backendUrl or VITE_BACKEND_URL
    const baseUrl = backendUrl ?? import.meta.env.VITE_BACKEND_URL ?? "";

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

  const value: SignalContextValue = {
    isConnected,
    subscribe,
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
