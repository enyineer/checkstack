/**
 * A generic interface for a WebSocket connection managed by the core server.
 * Plugins interact with WebSocket clients through this adapter, insulating
 * them from the underlying Bun WebSocket API.
 */
export interface WsConnection {
  /** Send a string message to the client */
  send(data: string): void;
  /** Close the connection */
  close(): void;
}

/**
 * Per-connection handlers returned by a route handler's `onConnection` callback.
 * These closures capture the connection's state (e.g., auth state, session data).
 */
export interface WsConnectionHandlers {
  onMessage: (message: string) => void | Promise<void>;
  onClose: () => void;
}

/**
 * A WebSocket route handler registered by a plugin.
 * The core server calls `onConnection` when a new WebSocket is opened on
 * the handler's registered path, and the handler returns per-connection
 * event callbacks.
 */
export interface WebSocketRouteHandler {
  /**
   * Called when a new WebSocket connection opens on this route.
   * Return per-connection message/close handlers.
   */
  onConnection(ws: WsConnection): WsConnectionHandlers;
}

/**
 * Scoped registry for plugin WebSocket route handlers.
 * Each plugin receives a scoped instance (via factory) that auto-prefixes
 * the pluginId — just like the RPC service.
 *
 * Plugins register handlers with a local path segment, and the core server
 * makes them available under `/api/ws/{pluginId}{path}`.
 *
 * @example
 * ```ts
 * // In satellite-backend init (pluginId "satellite" is auto-prefixed):
 * wsRegistry.register("/", handler);
 * // → Available at /api/ws/satellite
 *
 * wsRegistry.register("/connect", handler);
 * // → Available at /api/ws/satellite/connect
 * ```
 */
export interface WebSocketRouteRegistry {
  /**
   * Register a WebSocket route handler at the given path.
   * The pluginId prefix is applied automatically by the scoped factory.
   */
  register(path: string, handler: WebSocketRouteHandler): void;
}

/**
 * Core-level store for all registered WS routes.
 * The backend server uses this to look up handlers during WebSocket upgrade.
 * Not exposed to plugins — they interact via the scoped `WebSocketRouteRegistry`.
 */
export interface WebSocketRouteStore {
  /** Look up a handler by full path (e.g., "satellite" or "satellite/connect"). */
  getHandler(fullPath: string): WebSocketRouteHandler | undefined;
}
