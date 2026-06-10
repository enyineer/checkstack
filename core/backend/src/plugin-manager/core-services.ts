import { Pool } from "pg";
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
  createAdvisoryLockService,
  ResourceResolverRegistry,
} from "@checkstack/backend-api";
import { AuthApi } from "@checkstack/auth-common";
import type { ServiceRegistry } from "../services/service-registry";
import { rootLogger } from "../logger";
import { db, lockPool } from "../db";
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
import { createScopedDb } from "../utils/scoped-db.js";
import {
  WebSocketRouteStoreImpl,
  createScopedWsRegistry,
} from "../services/ws-route-registry";
import {
  CoreReadinessRegistry,
  createScopedReadinessRegistry,
} from "../services/readiness-registry";

/**
 * Check if a PostgreSQL schema exists.
 */
async function schemaExists(pool: Pool, schemaName: string): Promise<boolean> {
  const result = await pool.query(
    "SELECT 1 FROM information_schema.schemata WHERE schema_name = $1",
    [schemaName],
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
}): {
  collectorRegistry: CoreCollectorRegistry;
  wsStore: WebSocketRouteStoreImpl;
  readinessRegistry: CoreReadinessRegistry;
} {
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
            `🔄 Renaming schema ${oldSchema} → ${assignedSchema} for plugin ${pluginId}`,
          );
          await adminPool.query(
            `ALTER SCHEMA "${oldSchema}" RENAME TO "${assignedSchema}"`,
          );
          break; // Only one rename needed
        }
      }
    }

    // Schema is created in plugin-loader.ts before migrations run.
    // Create scoped proxy on shared pool (no new connections)
    return createScopedDb(db, assignedSchema);
  });

  // 1b. Advisory Lock Factory (server-global, backed by the DEDICATED
  // `lockPool`, NOT `adminPool`). Both session locks (`tryAcquire`) and the
  // transaction-scoped `withXactLock` HOLD a connection for the lock's whole
  // lifetime while the locked work runs on `adminPool`. Drawing the lock
  // connection from a separate pool keeps the acquire graph acyclic
  // (lockPool -> adminPool, never back), so a held lock can never starve the
  // work pool into the `idle in transaction` deadlock. See `db.ts`.
  const advisoryLockService = createAdvisoryLockService(lockPool);
  registry.registerFactory(
    coreServices.advisoryLock,
    () => advisoryLockService,
  );

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

          // App-principal token: minted by `rpcClientAs` so an automation can
          // run as its configured service account. Resolve the application's
          // CURRENT rules/teams LIVE (never trust frozen claims) and return an
          // `application` principal, so it flows through the full access-rule
          // and team-scope enforcement - NOT the trusted service short-circuit.
          if (payload && typeof payload.appPrincipal === "string") {
            try {
              const rpcClient = await registry.get(coreServices.rpcClient, {
                pluginId: "core",
              });
              const authClient = rpcClient.forPlugin(AuthApi);
              const enriched = await authClient.enrichApplicationPrincipal({
                applicationId: payload.appPrincipal,
              });
              if (!enriched) return; // app no longer exists -> unauthenticated
              return {
                type: "application" as const,
                id: enriched.id,
                name: enriched.name,
                roles: enriched.roles,
                accessRules: enriched.accessRules,
                teamIds: enriched.teamIds,
              };
            } catch (error) {
              // SECURITY: Fail-Closed - never fall back to a broader principal.
              rootLogger.error(
                `[auth] app-principal enrichment failed for ${payload.appPrincipal}; denying. Error: ${error}`,
              );
              return;
            }
          }
        }

        // Strategy B: User Token (via registered strategy)
        try {
          const authStrategy = await registry.get(
            authenticationStrategyServiceRef,
            metadata,
          );
          if (authStrategy) {
            // AuthenticationStrategy.validate() returns RealUser | undefined
            return await (authStrategy as AuthenticationStrategy).validate(
              request,
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
            `[auth] getAnonymousAccessRules: RPC failed, returning empty array. Error: ${error}`,
          );
          return [];
        }
      },

      check: async (params) => {
        try {
          const rpcClient = await registry.get(coreServices.rpcClient, {
            pluginId: "core",
          });
          const authClient = rpcClient.forPlugin(AuthApi);
          return await authClient.check(params);
        } catch (error) {
          // SECURITY: Fail-Closed — deny access when auth service is unavailable
          rootLogger.error(
            `[auth] check: S2S call failed for ${params.objectType}:${params.objectId}. Denying access (Fail-Closed). Error: ${error}`,
          );
          return { hasAccess: false };
        }
      },

      listAccessibleObjectIds: async (params) => {
        try {
          const rpcClient = await registry.get(coreServices.rpcClient, {
            pluginId: "core",
          });
          const authClient = rpcClient.forPlugin(AuthApi);
          return await authClient.listAccessibleObjectIds(params);
        } catch (error) {
          // SECURITY: Fail-Closed — return empty set when auth service is unavailable
          rootLogger.error(
            `[auth] listAccessibleObjectIds: S2S call failed for type ${params.objectType}. Denying access (Fail-Closed). Error: ${error}`,
          );
          return [];
        }
      },

      hasAnyTypeGrant: async (params) => {
        try {
          const rpcClient = await registry.get(coreServices.rpcClient, {
            pluginId: "core",
          });
          const authClient = rpcClient.forPlugin(AuthApi);
          return await authClient.hasAnyTypeGrant(params);
        } catch (error) {
          // Fail OPEN here: this gates an ADDITIONAL 403 on already-filtered
          // (empty) results. A transient auth failure should degrade to a
          // 200-empty response, never escalate to a hard 403. Reporting
          // hasGrant:true makes the caller look "scoped to empty", not
          // "categorically unauthorized".
          rootLogger.error(
            `[auth] hasAnyTypeGrant: S2S call failed for type ${params.objectType}. Assuming a grant exists to avoid a spurious 403. Error: ${error}`,
          );
          return { hasGrant: true };
        }
      },

      authorizeCreate: async (params) => {
        // Fail-Closed: a create authorization that cannot be resolved must NOT
        // silently succeed. Re-throw so the create is rejected.
        const rpcClient = await registry.get(coreServices.rpcClient, {
          pluginId: "core",
        });
        const authClient = rpcClient.forPlugin(AuthApi);
        return await authClient.authorizeCreate(params);
      },

      setOwner: async (params) => {
        // Re-throw on failure rather than swallowing it. NOTE: this runs in the
        // auth middleware AFTER the create handler has already returned and
        // committed the resource row (see rpc.ts post-handler write), so there
        // is no automatic rollback — the throw surfaces a 5xx to the caller and
        // the object is left WITHOUT its owner tuple. An ownerless object has
        // zero team grants and no public marker, so access falls back to the
        // global rule (visible to global-rule holders, NOT to the intended
        // team) — a consistency gap, not a leak. There is no reconciler yet;
        // re-throwing at least makes the failure loud instead of silent.
        const rpcClient = await registry.get(coreServices.rpcClient, {
          pluginId: "core",
        });
        const authClient = rpcClient.forPlugin(AuthApi);
        await authClient.setOwner(params);
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
      init?: RequestInit,
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

  // 5b. Application-scoped RPC Client Factory.
  // Returns a builder that mints a short-lived app-principal token and returns
  // a client re-entering the live router AS THAT APPLICATION. The receiving
  // `authenticate` (Strategy A) resolves the token to an `application`
  // principal, so the call runs through the full access-rule + team-scope
  // enforcement - NOT the trusted service short-circuit. The automation
  // dispatch engine uses this to run an automation as its `runAs` account.
  registry.registerFactory(coreServices.rpcClientAs, () => {
    const apiBaseUrl = process.env.INTERNAL_URL || "http://localhost:3000";
    return async (applicationId: string): Promise<RpcClient> => {
      // Mint a FRESH short-lived token PER REQUEST (not once at client
      // construction). An automation run can stay live far longer than the
      // token TTL within a single un-suspended stretch - a long AI agent loop
      // making many tool calls, or many sequential actions - and a client that
      // baked one token would start failing with 401s once it expired. Minting
      // per request (mirroring the trusted client's `getCredentials`) means the
      // TTL only has to outlive a single in-flight request. (Across a
      // suspend/resume the engine rebuilds the client, so waits are unaffected
      // either way.)
      const authedFetch = async (
        input: RequestInfo | URL,
        init?: RequestInit,
      ): Promise<Response> => {
        const token = await jwtService.sign(
          { appPrincipal: applicationId },
          "5m",
        );
        const headers = new Headers(init?.headers);
        headers.set("Authorization", `Bearer ${token}`);
        return fetch(input, { ...init, headers });
      };
      const link = new RPCLink({
        url: `${apiBaseUrl}/api`,
        fetch: authedFetch,
      });
      const appClient = createORPCClient(link);
      return {
        forPlugin(def) {
          return (appClient as Record<string, unknown>)[
            def.pluginId
          ] as never;
        },
      };
    };
  });

  // 6. Health Check Registry (Scoped Factory - auto-prefixes strategy IDs with pluginId)
  const globalHealthCheckRegistry = new CoreHealthCheckRegistry();
  registry.registerFactory(coreServices.healthCheckRegistry, (metadata) =>
    createScopedHealthCheckRegistry(globalHealthCheckRegistry, metadata),
  );

  // 6b. Collector Registry (Scoped Factory - injects ownerPlugin automatically)
  const globalCollectorRegistry = new CoreCollectorRegistry();
  registry.registerFactory(coreServices.collectorRegistry, (metadata) =>
    createScopedCollectorRegistry(globalCollectorRegistry, metadata),
  );

  // 6c. Resource Resolver Registry (in-process singleton). Owning plugins
  // register a name/search resolver for their team-scopable resource types at
  // init; the auth backend reads it to render team grants by name and power the
  // grant picker. Same instance for every consumer in this process.
  const globalResourceResolverRegistry = new ResourceResolverRegistry();
  registry.registerFactory(
    coreServices.resourceResolverRegistry,
    () => globalResourceResolverRegistry,
  );

  // 7. RPC Service (Scoped Factory - uses pluginId for path derivation)
  registry.registerFactory(coreServices.rpc, (metadata) => {
    const { pluginId } = metadata;
    return {
      registerRouter: (router: unknown, contract: unknown): void => {
        pluginRpcRouters.set(pluginId, router);
        pluginContractRegistry.set(pluginId, contract);
        rootLogger.debug(
          `   -> Registered oRPC router and contract for '${pluginId}' at '/api/${pluginId}'`,
        );
      },
      registerHttpHandler: (
        handler: (req: Request) => Promise<Response>,
        path = "/",
      ): void => {
        const fullPath = `/api/${pluginId}${path === "/" ? "" : path}`;
        pluginHttpHandlers.set(fullPath, handler);
        rootLogger.debug(
          `   -> Registered HTTP handler for '${pluginId}' at '${fullPath}'`,
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

  // 10. WebSocket Route Registry (Scoped Factory - auto-prefixes with pluginId)
  const globalWsStore = new WebSocketRouteStoreImpl();
  registry.registerFactory(coreServices.wsRegistry, (metadata) =>
    createScopedWsRegistry(globalWsStore, metadata.pluginId),
  );

  // 11. Readiness Registry (Scoped Factory)
  // Plugins contribute probes that are aggregated by the /ready endpoint.
  const globalReadinessRegistry = new CoreReadinessRegistry();
  registry.registerFactory(coreServices.readinessRegistry, () =>
    createScopedReadinessRegistry(globalReadinessRegistry),
  );

  // Return global registries for lifecycle cleanup
  return {
    collectorRegistry: globalCollectorRegistry,
    wsStore: globalWsStore,
    readinessRegistry: globalReadinessRegistry,
  };
}
