import { z } from "zod";
import type { AccessRule, PluginMetadata } from "@checkstack/common";

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

  /**
   * Emit a signal only to users from the provided list who have the required access.
   * Uses S2S RPC to filter users via AuthApi before sending.
   *
   * @param signal - The signal to emit
   * @param userIds - List of user IDs to potentially send to
   * @param payload - Signal payload
   * @param pluginMetadata - The plugin metadata (for constructing fully-qualified access rule ID)
   * @param accessRule - Access rule object with native ID (will be prefixed with pluginId)
   *
   * @example
   * ```typescript
   * import { pluginMetadata, healthCheckAccess } from "@checkstack/healthcheck-common";
   *
   * await signalService.sendToAuthorizedUsers(
   *   HEALTH_STATE_CHANGED,
   *   subscriberUserIds,
   *   { systemId, newState: "degraded" },
   *   pluginMetadata,
   *   healthCheckAccess.status
   * );
   * ```
   */
  sendToAuthorizedUsers<T>(
    signal: Signal<T>,
    userIds: string[],
    payload: T,
    pluginMetadata: PluginMetadata,
    accessRule: AccessRule
  ): Promise<void>;
}

// =============================================================================
// CORE PLUGIN LIFECYCLE SIGNALS
// =============================================================================

/**
 * Broadcast to all frontends when a plugin has been fully installed on the backend.
 * Frontends should dynamically load the plugin's UI assets.
 */
export const PLUGIN_INSTALLED = createSignal(
  "core.plugin.installed",
  z.object({
    pluginId: z.string(),
  })
);

/**
 * Broadcast to all frontends when a plugin has been deregistered from the backend.
 * Frontends should remove the plugin's extensions and routes.
 */
export const PLUGIN_DEREGISTERED = createSignal(
  "core.plugin.deregistered",
  z.object({
    pluginId: z.string(),
  })
);
