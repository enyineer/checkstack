import { z } from "zod";

// =============================================================================
// SIGNAL DEFINITION
// =============================================================================

/**
 * A Signal is a typed event that can be broadcast from backend to frontend.
 * Similar to the Hook pattern but for realtime WebSocket communication.
 */
export interface Signal<T = unknown> {
  id: string;
  payloadSchema: z.ZodType<T>;
}

/**
 * Factory function for creating type-safe signals.
 *
 * @example
 * ```typescript
 * const NOTIFICATION_RECEIVED = createSignal(
 *   "notification.received",
 *   z.object({ id: z.string(), title: z.string() })
 * );
 * ```
 */
export function createSignal<T>(
  id: string,
  payloadSchema: z.ZodType<T>
): Signal<T> {
  return { id, payloadSchema };
}

// =============================================================================
// SIGNAL MESSAGE ENVELOPE
// =============================================================================

/**
 * The message envelope sent over WebSocket containing a signal payload.
 */
export interface SignalMessage<T = unknown> {
  signalId: string;
  payload: T;
  timestamp: string;
}

// =============================================================================
// CHANNEL TYPES
// =============================================================================

/**
 * Signal channels determine who receives the signal.
 */
export type SignalChannel =
  | { type: "broadcast" }
  | { type: "user"; userId: string };

// =============================================================================
// WEBSOCKET PROTOCOL MESSAGES
// =============================================================================

/**
 * Messages sent from client to server over WebSocket.
 */
export type ClientToServerMessage = { type: "ping" };

/**
 * Messages sent from server to client over WebSocket.
 */
export type ServerToClientMessage =
  | { type: "pong" }
  | { type: "connected"; userId: string }
  | { type: "signal"; signalId: string; payload: unknown; timestamp: string }
  | { type: "error"; message: string };

// =============================================================================
// SIGNAL SERVICE INTERFACE
// =============================================================================

/**
 * SignalService provides methods to emit signals to connected clients.
 *
 * Signals are pushed via WebSocket to connected frontends in realtime.
 * The service coordinates across backend instances via the EventBus.
 */
export interface SignalService {
  /**
   * Emit a broadcast signal to all connected clients.
   *
   * @example
   * ```typescript
   * await signalService.broadcast(SYSTEM_STATUS_CHANGED, { status: "maintenance" });
   * ```
   */
  broadcast<T>(signal: Signal<T>, payload: T): Promise<void>;

  /**
   * Emit a signal to a specific user.
   * Only WebSocket connections authenticated as this user will receive it.
   *
   * @example
   * ```typescript
   * await signalService.sendToUser(NOTIFICATION_RECEIVED, userId, { title: "New message" });
   * ```
   */
  sendToUser<T>(signal: Signal<T>, userId: string, payload: T): Promise<void>;

  /**
   * Emit a signal to multiple users.
   *
   * @example
   * ```typescript
   * await signalService.sendToUsers(NOTIFICATION_RECEIVED, [user1, user2], { title: "Alert" });
   * ```
   */
  sendToUsers<T>(
    signal: Signal<T>,
    userIds: string[],
    payload: T
  ): Promise<void>;
}
