import type { Hono, Context } from "hono";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { RPCHandler } from "@orpc/server/fetch";
import {
  coreServices,
  AuthService,
  RpcContext,
  Logger,
  Fetch,
  HealthCheckRegistry,
  type EmitHookFn,
  type Hook,
} from "@checkmate/backend-api";
import type { QueuePluginRegistry, QueueManager } from "@checkmate/queue-api";
import type { ServiceRegistry } from "../services/service-registry";
import type { EventBus } from "@checkmate/backend-api";
import type { PluginMetadata } from "@checkmate/common";

/**
 * Creates the API route handler for Hono.
 * Extracted from PluginManager for better organization.
 */
export function createApiRouteHandler({
  registry,
  pluginRpcRouters,
  pluginHttpHandlers,
  pluginMetadataRegistry,
}: {
  registry: ServiceRegistry;
  pluginRpcRouters: Map<string, unknown>;
  pluginHttpHandlers: Map<string, (req: Request) => Promise<Response>>;
  pluginMetadataRegistry: Map<string, PluginMetadata>;
}) {
  // Helper to get service from registry
  async function getService<T>(ref: {
    id: string;
    T: T;
  }): Promise<T | undefined> {
    try {
      return await registry.get(ref, { pluginId: "core" });
    } catch {
      return undefined;
    }
  }

  return async function handleApiRequest(c: Context) {
    // Extract pluginId from Hono path parameter (/api/:pluginId/*)
    const pluginId = c.req.param("pluginId") || "";
    const pathname = new URL(c.req.raw.url).pathname;

    // Build RPC handler lazily at request time
    // This ensures all plugins registered during init are included
    const rootRpcRouter: Record<string, unknown> = {};
    for (const [pluginId, router] of pluginRpcRouters.entries()) {
      rootRpcRouter[pluginId] = router;
    }

    const rpcHandler = new RPCHandler(
      rootRpcRouter as ConstructorParameters<typeof RPCHandler>[0]
    );

    // Resolve core services for RPC context
    const auth = await getService(coreServices.auth);
    const logger = await getService(coreServices.logger);
    const db = await getService(coreServices.database);
    const fetch = await getService(coreServices.fetch);
    const healthCheckRegistry = await getService(
      coreServices.healthCheckRegistry
    );
    const queuePluginRegistry = await getService(
      coreServices.queuePluginRegistry
    );
    const queueManager = await getService(coreServices.queueManager);
    const eventBus = await getService(coreServices.eventBus);

    if (
      !auth ||
      !logger ||
      !db ||
      !fetch ||
      !healthCheckRegistry ||
      !queuePluginRegistry ||
      !queueManager ||
      !eventBus
    ) {
      return c.json({ error: "Core services not initialized" }, 500);
    }

    const user = await (auth as AuthService).authenticate(c.req.raw);

    // Create emitHook function using eventBus
    const emitHook: EmitHookFn = async <T>(hook: Hook<T>, payload: T) => {
      await (eventBus as EventBus).emit(hook, payload);
    };

    // Lookup plugin metadata from registry
    const pluginMetadata: PluginMetadata | undefined =
      pluginMetadataRegistry.get(pluginId);

    if (!pluginMetadata) {
      return c.json({ error: "Plugin metadata not found in registry" }, 500);
    }

    const context: RpcContext = {
      pluginMetadata,
      auth: auth as AuthService,
      logger: logger as Logger,
      db: db as NodePgDatabase<Record<string, unknown>>,
      fetch: fetch as Fetch,
      healthCheckRegistry: healthCheckRegistry as HealthCheckRegistry,
      queuePluginRegistry: queuePluginRegistry as QueuePluginRegistry,
      queueManager: queueManager as QueueManager,
      user,
      emitHook,
    };

    // 1. Try oRPC first
    try {
      const { matched, response } = await rpcHandler.handle(c.req.raw, {
        prefix: "/api",
        context,
      });

      if (matched) {
        return c.newResponse(response.body, response);
      }

      logger.debug(`RPC mismatch for: ${c.req.method} ${pathname}`);
    } catch (error) {
      logger.error(`RPC Handler error: ${String(error)}`);
    }

    // 2. Try native handlers
    // Sort by path length (descending) to ensure more specific paths are tried first
    const sortedHandlers = [...pluginHttpHandlers.entries()].toSorted(function (
      a,
      b
    ) {
      return b[0].length - a[0].length;
    });

    for (const [path, handler] of sortedHandlers) {
      if (pathname.startsWith(path)) {
        return handler(c.req.raw);
      }
    }

    return c.json({ error: "Not Found" }, 404);
  };
}

/**
 * Registers the /api/:pluginId/* route with Hono.
 */
export function registerApiRoute(
  rootRouter: Hono,
  handler: ReturnType<typeof createApiRouteHandler>
) {
  rootRouter.all("/api/:pluginId/*", handler);
}
