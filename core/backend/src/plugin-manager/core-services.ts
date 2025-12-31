import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import {
  coreServices,
  AuthService,
  authenticationStrategyServiceRef,
  RpcService,
  RpcClient,
  EventBus as IEventBus,
  AuthenticationStrategy,
} from "@checkmate/backend-api";
import type { AuthClient } from "@checkmate/auth-common";
import type { ServiceRegistry } from "../services/service-registry";
import { rootLogger } from "../logger";
import { db } from "../db";
import { jwtService } from "../services/jwt";
import { CoreHealthCheckRegistry } from "../services/health-check-registry";
import { EventBus } from "../services/event-bus.js";

/**
 * Registers all core services with the service registry.
 * Extracted from PluginManager for better organization.
 */
export function registerCoreServices({
  registry,
  adminPool,
  pluginRpcRouters,
  pluginHttpHandlers,
}: {
  registry: ServiceRegistry;
  adminPool: Pool;
  pluginRpcRouters: Map<string, unknown>;
  pluginHttpHandlers: Map<string, (req: Request) => Promise<Response>>;
}) {
  // 1. Database Factory (Scoped)
  registry.registerFactory(coreServices.database, async (pluginId) => {
    const assignedSchema = `plugin_${pluginId}`;

    // Ensure Schema Exists
    await adminPool.query(`CREATE SCHEMA IF NOT EXISTS "${assignedSchema}"`);

    // Create Scoped Connection
    const baseUrl = process.env.DATABASE_URL;
    if (!baseUrl) throw new Error("DATABASE_URL is not defined");

    const connector = baseUrl.includes("?") ? "&" : "?";
    const scopedUrl = `${baseUrl}${connector}options=-c%20search_path%3D${assignedSchema}`;

    const pluginPool = new Pool({ connectionString: scopedUrl });
    return drizzle(pluginPool);
  });

  // 2. Logger Factory
  registry.registerFactory(coreServices.logger, (pluginId) => {
    return rootLogger.child({ plugin: pluginId });
  });

  // 3. Auth Factory (Scoped)
  // Cache for anonymous permissions to avoid repeated DB queries
  let anonymousPermissionsCache: string[] | undefined;
  let anonymousCacheTime = 0;
  const CACHE_TTL_MS = 60_000; // 1 minute cache

  registry.registerFactory(coreServices.auth, (pluginId) => {
    const authService: AuthService = {
      authenticate: async (request: Request) => {
        const authHeader = request.headers.get("Authorization");
        const token = authHeader?.replace("Bearer ", "");

        // Strategy A: Service Token (backend-to-backend)
        if (token) {
          const payload = await jwtService.verify(token);
          if (payload && payload.service) {
            // Service tokens return ServiceUser type
            return {
              type: "service" as const,
              pluginId: payload.service as string,
            };
          }
        }

        // Strategy B: User Token (via registered strategy)
        try {
          const authStrategy = await registry.get(
            authenticationStrategyServiceRef,
            pluginId
          );
          if (authStrategy) {
            // AuthenticationStrategy.validate() returns RealUser | undefined
            return await (authStrategy as AuthenticationStrategy).validate(
              request
            );
          }
        } catch {
          // No strategy registered yet
        }
      },

      getCredentials: async () => {
        const token = await jwtService.sign({ service: pluginId }, "5m");
        return { headers: { Authorization: `Bearer ${token}` } };
      },

      getAnonymousPermissions: async (): Promise<string[]> => {
        const now = Date.now();
        // Return cached value if still valid
        if (
          anonymousPermissionsCache !== undefined &&
          now - anonymousCacheTime < CACHE_TTL_MS
        ) {
          return anonymousPermissionsCache;
        }

        // Use RPC client to call auth-backend's getAnonymousPermissions endpoint
        try {
          const rpcClient = await registry.get(coreServices.rpcClient, "core");
          const authClient = rpcClient.forPlugin<AuthClient>("auth-backend");
          const permissions = await authClient.getAnonymousPermissions();

          // Update cache
          anonymousPermissionsCache = permissions;
          anonymousCacheTime = now;

          return permissions;
        } catch (error) {
          // RPC client not available yet (during startup), return empty
          rootLogger.warn(
            `[auth] getAnonymousPermissions: RPC failed, returning empty array. Error: ${error}`
          );
          return [];
        }
      },
    };
    return authService;
  });

  // 4. Fetch Factory (Scoped)
  registry.registerFactory(coreServices.fetch, async (pluginId) => {
    const auth = await registry.get(coreServices.auth, pluginId);
    const apiBaseUrl = process.env.API_BASE_URL || "http://localhost:3000";

    const fetchWithAuth = async (
      input: RequestInfo | URL,
      init?: RequestInit
    ) => {
      const { headers: authHeaders } = await auth.getCredentials();
      const mergedHeaders = new Headers(init?.headers);
      for (const [k, v] of Object.entries(authHeaders)) {
        mergedHeaders.set(k, v);
      }
      return fetch(input, { ...init, headers: mergedHeaders });
    };

    const forPlugin = (targetPluginId: string) => {
      const pluginBaseUrl = `${apiBaseUrl}/api/${targetPluginId}`;

      const pluginFetch = async (path: string, init?: RequestInit) => {
        const url = `${pluginBaseUrl}${path.startsWith("/") ? "" : "/"}${path}`;
        return fetchWithAuth(url, init);
      };

      return {
        fetch: pluginFetch,
        get: (path: string, init?: RequestInit) =>
          pluginFetch(path, { ...init, method: "GET" }),
        post: (path: string, body?: unknown, init?: RequestInit) =>
          pluginFetch(path, {
            ...init,
            method: "POST",
            headers: { "Content-Type": "application/json", ...init?.headers },
            body: body ? JSON.stringify(body) : undefined,
          }),
        put: (path: string, body?: unknown, init?: RequestInit) =>
          pluginFetch(path, {
            ...init,
            method: "PUT",
            headers: { "Content-Type": "application/json", ...init?.headers },
            body: body ? JSON.stringify(body) : undefined,
          }),
        patch: (path: string, body?: unknown, init?: RequestInit) =>
          pluginFetch(path, {
            ...init,
            method: "PATCH",
            headers: { "Content-Type": "application/json", ...init?.headers },
            body: body ? JSON.stringify(body) : undefined,
          }),
        delete: (path: string, init?: RequestInit) =>
          pluginFetch(path, { ...init, method: "DELETE" }),
      };
    };

    return {
      fetch: fetchWithAuth,
      forPlugin,
    };
  });

  // 5. RPC Client Factory (Scoped, Typed)
  registry.registerFactory(coreServices.rpcClient, async (pluginId) => {
    const fetchService = await registry.get(coreServices.fetch, pluginId);
    const apiBaseUrl = process.env.API_BASE_URL || "http://localhost:3000";

    // Create RPC Link using the fetch service (already has auth)
    const link = new RPCLink({
      url: `${apiBaseUrl}/api`,
      fetch: fetchService.fetch,
    });

    const client = createORPCClient(link);

    const rpcClient: RpcClient = {
      forPlugin<T>(targetPluginId: string): T {
        return (client as Record<string, T>)[targetPluginId];
      },
    };

    return rpcClient;
  });

  // 6. Health Check Registry (Global Singleton)
  const healthCheckRegistry = new CoreHealthCheckRegistry();
  registry.registerFactory(
    coreServices.healthCheckRegistry,
    () => healthCheckRegistry
  );

  // 7. RPC Service (Global Singleton)
  registry.registerFactory(
    coreServices.rpc,
    () =>
      ({
        registerRouter: (pluginId: string, router: unknown): void => {
          pluginRpcRouters.set(pluginId, router);
          rootLogger.debug(`   -> Registered oRPC router for '${pluginId}'`);
        },
        registerHttpHandler: (
          path: string,
          handler: (req: Request) => Promise<Response>
        ): void => {
          pluginHttpHandlers.set(path, handler);
          rootLogger.debug(`   -> Registered HTTP handler for path '${path}'`);
        },
      } satisfies RpcService)
  );

  // 8. Config Service (Scoped Factory)
  registry.registerFactory(coreServices.config, async (pluginId) => {
    const { ConfigServiceImpl } = await import("../services/config-service.js");
    return new ConfigServiceImpl(pluginId, db);
  });

  // 9. EventBus (Global Singleton)
  let eventBusInstance: IEventBus | undefined;
  registry.registerFactory(coreServices.eventBus, async () => {
    if (!eventBusInstance) {
      const queueManager = await registry.get(
        coreServices.queueManager,
        "core"
      );
      const logger = await registry.get(coreServices.logger, "core");
      eventBusInstance = new EventBus(queueManager, logger);
    }
    return eventBusInstance;
  });
}
