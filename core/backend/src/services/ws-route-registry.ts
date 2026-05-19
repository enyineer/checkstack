import type {
  WebSocketRouteRegistry,
  WebSocketRouteHandler,
  WebSocketRouteStore,
} from "@checkstack/backend-api";

/**
 * Global store for all registered WebSocket route handlers.
 * Plugins don't interact with this directly — they use a scoped
 * `WebSocketRouteRegistry` that auto-prefixes the pluginId.
 */
export class WebSocketRouteStoreImpl implements WebSocketRouteStore {
  private handlers = new Map<string, WebSocketRouteHandler>();

  /** Register a handler at a fully-qualified path (e.g., "satellite" or "satellite/connect"). */
  registerHandler(fullPath: string, handler: WebSocketRouteHandler): void {
    if (this.handlers.has(fullPath)) {
      throw new Error(
        `WebSocket route already registered: /api/ws/${fullPath}`,
      );
    }
    this.handlers.set(fullPath, handler);
  }

  getHandler(fullPath: string): WebSocketRouteHandler | undefined {
    return this.handlers.get(fullPath);
  }
}

/**
 * Create a scoped WebSocket route registry for a specific plugin.
 * Auto-prefixes all paths with the plugin's ID.
 */
export function createScopedWsRegistry(
  store: WebSocketRouteStoreImpl,
  pluginId: string,
): WebSocketRouteRegistry {
  return {
    register(path: string, handler: WebSocketRouteHandler): void {
      // Normalize: "/" maps to just the pluginId, "/foo" maps to "pluginId/foo".
      // Paths are documented to start with `/` (see WebSocketRouteRegistry).
      const suffix = path === "/" ? "" : path;
      const fullPath = `${pluginId}${suffix}`;
      store.registerHandler(fullPath, handler);
    },
  };
}
