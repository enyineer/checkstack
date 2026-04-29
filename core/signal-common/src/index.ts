import { z } from "zod";
import type { AccessRule, PluginMetadata } from "@checkstack/common";

// =============================================================================
// SIGNAL DEFINITION
// =============================================================================

/**
 * A Signal is a typed event that can be broadcast from backend to frontend.
 * The `pluginId` field lets the realtime layer auto-invalidate
 * react-query caches keyed `[[pluginId]]` without per-consumer wiring.
 */
export interface Signal<T = unknown> {
  id: string;
  pluginId: string;
  payloadSchema: z.ZodType<T>;
}

/**
 * Factory function for creating type-safe signals.
 *
 * The signal id is constructed as `${pluginMetadata.pluginId}.${event}`
 * so the owning plugin is encoded into the wire format and the frontend
 * can route invalidations to `[[pluginId]]` automatically.
 *
 * @example
 * ```typescript
 * import { pluginMetadata } from "./plugin-metadata";
 *
 * export const NOTIFICATION_RECEIVED = createSignal({
 *   pluginMetadata,
 *   event: "received",
 *   payloadSchema: z.object({ id: z.string(), title: z.string() }),
 * });
 * ```
 */
export function createSignal<T>(props: {
  pluginMetadata: PluginMetadata;
  event: string;
  payloadSchema: z.ZodType<T>;
}): Signal<T> {
  const { pluginMetadata, event, payloadSchema } = props;
  return {
    id: `${pluginMetadata.pluginId}.${event}`,
    pluginId: pluginMetadata.pluginId,
    payloadSchema,
  };
}

// =============================================================================
// SIGNAL MESSAGE ENVELOPE
// =============================================================================

/**
 * The message envelope sent over WebSocket containing a signal payload.
 *
 * `pluginId` is carried alongside `signalId` so the frontend can route
 * cache invalidations to `[[pluginId]]` without parsing the id.
 */
export interface SignalMessage<T = unknown> {
  signalId: string;
  pluginId: string;
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
  | {
      type: "signal";
      signalId: string;
      pluginId: string;
      payload: unknown;
      timestamp: string;
    }
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
 * Synthetic metadata for framework-level signals that are not owned by any plugin.
 * The "core" pluginId reserves a top-level namespace; no plugin may register itself
 * with that id.
 */
const coreSignalsPluginMetadata: PluginMetadata = { pluginId: "core" };

/**
 * Broadcast to all frontends when a plugin has been fully installed on the backend.
 * Frontends should dynamically load the plugin's UI assets.
 */
export const PLUGIN_INSTALLED = createSignal({
  pluginMetadata: coreSignalsPluginMetadata,
  event: "plugin.installed",
  payloadSchema: z.object({
    pluginId: z.string(),
  }),
});

/**
 * Broadcast to all frontends when a plugin has been deregistered from the backend.
 * Frontends should remove the plugin's extensions and routes.
 */
export const PLUGIN_DEREGISTERED = createSignal({
  pluginMetadata: coreSignalsPluginMetadata,
  event: "plugin.deregistered",
  payloadSchema: z.object({
    pluginId: z.string(),
  }),
});
