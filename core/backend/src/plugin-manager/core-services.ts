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
} from "@checkstack/backend-api";
import { AuthApi } from "@checkstack/auth-common";
import type { ServiceRegistry } from "../services/service-registry";
import { rootLogger } from "../logger";
import { db } from "../db";
import { jwtService } from "../services/jwt";
import {
  CoreHealthCheckRegistry,
  createScopedHealthCheckRegistry,
} from "../services/health-check-registry";
import {
  CoreCollectorRegistry,
  createScopedCollectorRegistry,
} from "../services/collector-registry";
import { EventBus } from "../services/event-bus.js";
import { getPluginSchemaName } from "@checkstack/drizzle-helper";

/**
 * Check if a PostgreSQL schema exists.
 */
async function schemaExists(pool: Pool, schemaName: string): Promise<boolean> {
  const result = await pool.query(
    "SELECT 1 FROM information_schema.schemata WHERE schema_name = $1",
    [schemaName]
  );
  return result.rows.length > 0;
}

/**
 * Registers all core services with the service registry.
 * Extracted from PluginManager for better organization.
 * Returns the global registries for lifecycle cleanup.
 */
export function registerCoreServices({
  registry,
  adminPool,
  pluginRpcRouters,
  pluginHttpHandlers,
  pluginContractRegistry,
}: {
  registry: ServiceRegistry;
  adminPool: Pool;
  pluginRpcRouters: Map<string, unknown>;
  pluginHttpHandlers: Map<string, (req: Request) => Promise<Response>>;
  pluginContractRegistry: Map<string, unknown>;
}): { collectorRegistry: CoreCollectorRegistry } {
  // 1. Database Factory (Scoped)
  registry.registerFactory(coreServices.database, async (metadata) => {
    const { pluginId, previousPluginIds } = metadata;
    const assignedSchema = getPluginSchemaName(pluginId);

    // Pre-flight: Check if this is a schema rename scenario
    if (previousPluginIds && previousPluginIds.length > 0) {
      for (const oldId of previousPluginIds) {
        const oldSchema = getPluginSchemaName(oldId);
        const oldExists = await schemaExists(adminPool, oldSchema);
        const newExists = await schemaExists(adminPool, assignedSchema);

        if (oldExists && !newExists) {
          rootLogger.info(
            `🔄 Renaming schema ${oldSchema} → ${assignedSchema} for plugin ${pluginId}`
          );
          await adminPool.query(
            `ALTER SCHEMA "${oldSchema}" RENAME TO "${assignedSchema}"`
          );
          break; // Only one rename needed
        }
      }
    }

    // Ensure Schema Exists (creates if not already renamed/created)
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
  registry.registerFactory(coreServices.logger, (metadata) => {
    return rootLogger.child({ plugin: metadata.pluginId });
  });

  // 3. Auth Factory (Scoped)
  // Cache for anonymous access rules to avoid repeated DB queries
  let anonymousAccessRulesCache: string[] | undefined;
  let anonymousCacheTime = 0;
  const CACHE_TTL_MS = 60_000; // 1 minute cache

  registry.registerFactory(coreServices.auth, (metadata) => {
    const { pluginId } = metadata;
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
            metadata
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

      getAnonymousAccessRules: async (): Promise<string[]> => {
        const now = Date.now();
        // Return cached value if still valid
        if (
          anonymousAccessRulesCache !== undefined &&
          now - anonymousCacheTime < CACHE_TTL_MS
        ) {
          return anonymousAccessRulesCache;
        }

        // Use RPC client to call auth-backend's getAnonymousAccessRules endpoint
        try {
          const rpcClient = await registry.get(coreServices.rpcClient, {
            pluginId: "core",
          });
          const authClient = rpcClient.forPlugin(AuthApi);
          const accessRulesResult = await authClient.getAnonymousAccessRules();

          // Update cache
          anonymousAccessRulesCache = accessRulesResult;
          anonymousCacheTime = now;

          return accessRulesResult;
        } catch (error) {
          // RPC client not available yet (during startup), return empty
          rootLogger.warn(
            `[auth] getAnonymousAccessRules: RPC failed, returning empty array. Error: ${error}`
          );
          return [];
        }
      },

      checkResourceTeamAccess: async (params) => {
        try {
          const rpcClient = await registry.get(coreServices.rpcClient, {
            pluginId: "core",
          });
          const authClient = rpcClient.forPlugin(AuthApi);
          return await authClient.checkResourceTeamAccess(params);
        } catch {
          // Fall back to global access on error
          return { hasAccess: params.hasGlobalAccess };
        }
      },

      getAccessibleResourceIds: async (params) => {
        try {
          const rpcClient = await registry.get(coreServices.rpcClient, {
            pluginId: "core",
          });
          const authClient = rpcClient.forPlugin(AuthApi);
          return await authClient.getAccessibleResourceIds(params);
        } catch {
          // Fall back to global access on error
          return params.hasGlobalAccess ? params.resourceIds : [];
        }
      },
    };
    return authService;
  });

  // 4. Fetch Factory (Scoped)
  registry.registerFactory(coreServices.fetch, async (metadata) => {
    const auth = await registry.get(coreServices.auth, metadata);
    const apiBaseUrl = process.env.INTERNAL_URL || "http://localhost:3000";

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
  registry.registerFactory(coreServices.rpcClient, async (metadata) => {
    const fetchService = await registry.get(coreServices.fetch, metadata);
    const apiBaseUrl = process.env.INTERNAL_URL || "http://localhost:3000";

    // Create RPC Link using the fetch service (already has auth)
    const link = new RPCLink({
      url: `${apiBaseUrl}/api`,
      fetch: fetchService.fetch,
    });

    const client = createORPCClient(link);

    const rpcClient: RpcClient = {
      forPlugin(def) {
        // Type safety is provided by the RpcClient interface - InferClient<T>
        // extracts the typed client from the ClientDefinition passed in
        return (client as Record<string, unknown>)[def.pluginId] as never;
      },
    };

    return rpcClient;
  });

  // 6. Health Check Registry (Scoped Factory - auto-prefixes strategy IDs with pluginId)
  const globalHealthCheckRegistry = new CoreHealthCheckRegistry();
  registry.registerFactory(coreServices.healthCheckRegistry, (metadata) =>
    createScopedHealthCheckRegistry(globalHealthCheckRegistry, metadata)
  );

  // 6b. Collector Registry (Scoped Factory - injects ownerPlugin automatically)
  const globalCollectorRegistry = new CoreCollectorRegistry();
  registry.registerFactory(coreServices.collectorRegistry, (metadata) =>
    createScopedCollectorRegistry(globalCollectorRegistry, metadata)
  );

  // 7. RPC Service (Scoped Factory - uses pluginId for path derivation)
  registry.registerFactory(coreServices.rpc, (metadata) => {
    const { pluginId } = metadata;
    return {
      registerRouter: (router: unknown, contract: unknown): void => {
        pluginRpcRouters.set(pluginId, router);
        pluginContractRegistry.set(pluginId, contract);
        rootLogger.debug(
          `   -> Registered oRPC router and contract for '${pluginId}' at '/api/${pluginId}'`
        );
      },
      registerHttpHandler: (
        handler: (req: Request) => Promise<Response>,
        path = "/"
      ): void => {
        const fullPath = `/api/${pluginId}${path === "/" ? "" : path}`;
        pluginHttpHandlers.set(fullPath, handler);
        rootLogger.debug(
          `   -> Registered HTTP handler for '${pluginId}' at '${fullPath}'`
        );
      },
    } satisfies RpcService;
  });

  // 8. Config Service (Scoped Factory)
  registry.registerFactory(coreServices.config, async (metadata) => {
    const { ConfigServiceImpl } = await import("../services/config-service.js");
    return new ConfigServiceImpl(metadata.pluginId, db);
  });

  // 9. EventBus (Global Singleton)
  let eventBusInstance: IEventBus | undefined;
  registry.registerFactory(coreServices.eventBus, async () => {
    if (!eventBusInstance) {
      const queueManager = await registry.get(coreServices.queueManager, {
        pluginId: "core",
      });
      const logger = await registry.get(coreServices.logger, {
        pluginId: "core",
      });
      eventBusInstance = new EventBus(queueManager, logger);
    }
    return eventBusInstance;
  });

  // Return global registries for lifecycle cleanup
  return { collectorRegistry: globalCollectorRegistry };
}
