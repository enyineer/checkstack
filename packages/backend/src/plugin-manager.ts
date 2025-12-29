import { drizzle, NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import path from "node:path";
import fs from "node:fs";
import { Hono } from "hono";
import { adminPool, db } from "./db";
import { plugins } from "./schema";
import { eq, and } from "drizzle-orm";
import { ServiceRegistry } from "./services/service-registry";
import {
  coreServices,
  BackendPlugin,
  ServiceRef,
  ExtensionPoint,
  Deps,
  ResolvedDeps,
  AuthService,
  authenticationStrategyServiceRef,
  RpcService,
  RpcContext,
  Logger,
  Fetch,
  HealthCheckRegistry,
  AuthenticationStrategy,
} from "@checkmate/backend-api";
import type { QueuePluginRegistry, QueueFactory } from "@checkmate/queue-api";
import { RPCHandler } from "@orpc/server/fetch";
import type { Permission } from "@checkmate/common";
import { rootLogger } from "./logger";
import { jwtService } from "./services/jwt";
import { CoreHealthCheckRegistry } from "./services/health-check-registry";
import { fixMigrationsSchemaReferences } from "./utils/fix-migrations";
import {
  discoverLocalPlugins,
  syncPluginsToDatabase,
} from "./utils/plugin-discovery";

interface PendingInit {
  pluginId: string;
  pluginPath: string;
  deps: Record<string, ServiceRef<unknown>>;
  init: (deps: Record<string, unknown>) => Promise<void>;
  schema?: Record<string, unknown>;
}

export class PluginManager {
  private registry = new ServiceRegistry();
  private extensionPointProxies = new Map<string, unknown>();
  private pluginRpcRouters = new Map<string, unknown>();
  private pluginHttpHandlers = new Map<
    string,
    (req: Request) => Promise<Response>
  >();

  constructor() {
    this.registerCoreServices();
  }

  private registerCoreServices() {
    // 1. Database Factory (Scoped)
    this.registry.registerFactory(coreServices.database, async (pluginId) => {
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
    this.registry.registerFactory(coreServices.logger, (pluginId) => {
      return rootLogger.child({ plugin: pluginId });
    });

    // 3. Auth Factory (Scoped)
    this.registry.registerFactory(coreServices.auth, (pluginId) => {
      const authService: AuthService = {
        authenticate: async (request: Request) => {
          const authHeader = request.headers.get("Authorization");
          const token = authHeader?.replace("Bearer ", "");

          // Strategy A: Service Token
          if (token) {
            const payload = await jwtService.verify(token);
            if (payload) {
              return {
                id: (payload.sub as string) || (payload.service as string),
                permissions: ["*"], // Service tokens grant all
                roles: ["service"],
              };
            }
          }

          // Strategy B: User Token (via registered strategy)
          try {
            const authStrategy = await this.registry.get(
              authenticationStrategyServiceRef,
              pluginId
            );
            if (authStrategy) {
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
      };
      return authService;
    });

    // 4. Fetch Factory (Scoped)
    this.registry.registerFactory(coreServices.fetch, async (pluginId) => {
      const auth = await this.registry.get(coreServices.auth, pluginId);
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
          const url = `${pluginBaseUrl}${
            path.startsWith("/") ? "" : "/"
          }${path}`;
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

    // 5. Health Check Registry (Global Singleton)
    const healthCheckRegistry = new CoreHealthCheckRegistry();
    this.registry.registerFactory(
      coreServices.healthCheckRegistry,
      () => healthCheckRegistry
    );

    // 6. RPC Service (Global Singleton)
    this.registry.registerFactory(
      coreServices.rpc,
      () =>
        ({
          registerRouter: (pluginId: string, router: unknown): void => {
            this.pluginRpcRouters.set(pluginId, router);
            rootLogger.info(`   -> Registered oRPC router for '${pluginId}'`);
          },
          registerHttpHandler: (
            path: string,
            handler: (req: Request) => Promise<Response>
          ): void => {
            this.pluginHttpHandlers.set(path, handler);
            rootLogger.info(`   -> Registered HTTP handler for path '${path}'`);
          },
        } satisfies RpcService)
    );

    // 7. Config Service (Scoped Factory)
    this.registry.registerFactory(coreServices.config, async (pluginId) => {
      const { ConfigServiceImpl } = await import(
        "./services/config-service.js"
      );
      return new ConfigServiceImpl(pluginId, db);
    });
  }

  registerExtensionPoint<T>(ref: ExtensionPoint<T>, impl: T) {
    const proxy = this.getExtensionPointProxy(ref);
    (proxy as Record<string, (...args: unknown[]) => unknown>)[
      "$$setImplementation"
    ](impl);
    rootLogger.info(`   -> Registered extension point '${ref.id}'`);
  }

  getExtensionPoint<T>(ref: ExtensionPoint<T>): T {
    return this.getExtensionPointProxy(ref);
  }

  registerPermissions(pluginId: string, permissions: Permission[]) {
    const prefixed = permissions.map((p) => ({
      ...p,
      id: `${pluginId}.${p.id}`,
    }));
    rootLogger.info(
      `   -> Registered ${prefixed.length} permissions for ${pluginId}`
    );
    // TODO: Store these in a database or central registry
  }

  public sortPlugins(
    pendingInits: {
      pluginId: string;
      deps: Record<string, ServiceRef<unknown>>;
    }[],
    providedBy: Map<string, string>
  ): string[] {
    rootLogger.debug("🔄 Calculating initialization order...");

    const inDegree = new Map<string, number>();
    const graph = new Map<string, string[]>();

    for (const p of pendingInits) {
      inDegree.set(p.pluginId, 0);
      graph.set(p.pluginId, []);
    }

    for (const p of pendingInits) {
      const consumerId = p.pluginId;
      for (const [, ref] of Object.entries(p.deps)) {
        const serviceId = ref.id;
        const providerId = providedBy.get(serviceId);

        if (providerId && providerId !== consumerId) {
          if (!graph.has(providerId)) {
            graph.set(providerId, []);
          }
          graph.get(providerId)!.push(consumerId);
          inDegree.set(consumerId, (inDegree.get(consumerId) || 0) + 1);
        }
      }
    }

    const queue: string[] = [];
    for (const [id, count] of inDegree.entries()) {
      if (count === 0) {
        queue.push(id);
      }
    }

    const sortedIds: string[] = [];
    while (queue.length > 0) {
      const u = queue.shift()!;
      sortedIds.push(u);

      const dependents = graph.get(u) || [];
      for (const v of dependents) {
        inDegree.set(v, inDegree.get(v)! - 1);
        if (inDegree.get(v) === 0) {
          queue.push(v);
        }
      }
    }

    if (sortedIds.length !== pendingInits.length) {
      throw new Error("Circular dependency detected");
    }

    return sortedIds;
  }

  private getExtensionPointProxy<T>(ref: ExtensionPoint<T>): T {
    let proxy = this.extensionPointProxies.get(ref.id) as T | undefined;
    if (!proxy) {
      const buffer: { method: string | symbol; args: unknown[] }[] = [];
      let implementation: T | undefined;

      proxy = new Proxy(
        {},
        {
          get: (target, prop) => {
            if (prop === "$$setImplementation") {
              return (impl: T) => {
                implementation = impl;
                for (const call of buffer) {
                  (
                    implementation as Record<
                      string | symbol,
                      (...args: unknown[]) => unknown
                    >
                  )[call.method](...call.args);
                }
                buffer.length = 0;
              };
            }
            return (...args: unknown[]) => {
              if (implementation) {
                return (
                  implementation as Record<
                    string | symbol,
                    (...args: unknown[]) => unknown
                  >
                )[prop](...args);
              } else {
                buffer.push({ method: prop, args });
              }
            };
          },
        }
      ) as T;
      this.extensionPointProxies.set(ref.id, proxy);
    }
    return proxy;
  }

  async loadPlugins(rootRouter: Hono, manualPlugins: BackendPlugin[] = []) {
    rootLogger.info("🔍 Discovering plugins...");

    // 1. Discover local BACKEND plugins from monorepo using package.json metadata
    const workspaceRoot = path.join(__dirname, "..", "..", "..");
    const localPlugins = discoverLocalPlugins({
      workspaceRoot,
      type: "backend", // Only discover backend plugins
    });

    rootLogger.debug(
      `   -> Found ${localPlugins.length} local backend plugin(s) in workspace`
    );

    // 2. Sync local plugins to database (prevents stale entries)
    await syncPluginsToDatabase({ localPlugins, db });

    // 3. Load all enabled BACKEND plugins from database (now always up-to-date)
    const allPlugins = await db
      .select()
      .from(plugins)
      .where(and(eq(plugins.enabled, true), eq(plugins.type, "backend")));

    if (allPlugins.length === 0) {
      rootLogger.info("ℹ️  No enabled plugins found.");
      return;
    }

    // Phase 1: Load Modules & Register Services
    const pendingInits: PendingInit[] = [];

    const providedBy = new Map<string, string>(); // ServiceId -> PluginId

    for (const plugin of allPlugins) {
      rootLogger.info(`🔌 Loading module ${plugin.name}...`);

      try {
        // Try to import by package name first (works for npm-installed plugins)
        // Fall back to path for local plugins in plugins/ directory
        let pluginModule;
        try {
          pluginModule = await import(plugin.name);
        } catch {
          // For local plugins, the package name won't resolve, so use the path
          rootLogger.debug(
            `   -> Package name import failed, trying path: ${plugin.path}`
          );
          pluginModule = await import(plugin.path);
        }

        const backendPlugin: BackendPlugin = pluginModule.default;
        this.registerPlugin(
          backendPlugin,
          plugin.path,
          pendingInits,
          providedBy
        );
      } catch (error) {
        rootLogger.error(`❌ Failed to load module for ${plugin.name}:`, error);
        rootLogger.error(`   Expected path: ${plugin.path}`);
      }
    }

    // Phase 1.5: Register manual plugins
    for (const backendPlugin of manualPlugins) {
      this.registerPlugin(backendPlugin, "", pendingInits, providedBy);
    }

    // Phase 2: Initialize Plugins (Topological Sort)
    const sortedIds = this.sortPlugins(pendingInits, providedBy);
    rootLogger.info(`✅ Initialization Order: ${sortedIds.join(" -> ")}`);

    for (const id of sortedIds) {
      const p = pendingInits.find((x) => x.pluginId === id)!;
      rootLogger.info(`🚀 Initializing ${p.pluginId}...`);

      try {
        const pluginDb = await this.registry.get(
          coreServices.database,
          p.pluginId
        );

        // Run Migrations
        const migrationsFolder = path.join(p.pluginPath, "drizzle");
        if (fs.existsSync(migrationsFolder)) {
          try {
            // Fix any hardcoded "public" schema references
            fixMigrationsSchemaReferences(migrationsFolder);

            rootLogger.debug(
              `   -> Running migrations for ${p.pluginId} from ${migrationsFolder}`
            );
            await migrate(pluginDb, { migrationsFolder });
          } catch (error) {
            rootLogger.error(
              `❌ Failed migration of plugin ${p.pluginId}:`,
              error
            );
          }
        } else {
          rootLogger.debug(
            `   -> No migrations found for ${p.pluginId} (skipping)`
          );
        }

        // Resolve Dependencies
        const resolvedDeps: Record<string, unknown> = {};
        for (const [key, ref] of Object.entries(p.deps)) {
          resolvedDeps[key] = await this.registry.get(
            ref as ServiceRef<unknown>,
            p.pluginId
          );
        }

        // Inject Schema-aware Database if schema is provided
        // This takes precedence over any 'database' requested in deps
        if (p.schema) {
          const baseUrl = process.env.DATABASE_URL;
          const assignedSchema = `plugin_${p.pluginId}`;
          // Force search_path
          const scopedUrl = `${baseUrl}?options=-c%20search_path%3D${assignedSchema}`;
          const pluginPool = new Pool({ connectionString: scopedUrl });

          // Create schema-aware Drizzle instance
          resolvedDeps["database"] = drizzle(pluginPool, {
            schema: p.schema,
          });
        }

        try {
          await p.init(resolvedDeps);
          rootLogger.debug(`   -> Initialized ${p.pluginId}`);
        } catch (error) {
          rootLogger.error(`❌ Failed to initialize ${p.pluginId}:`, error);
        }
      } catch (error) {
        rootLogger.error(
          `❌ Critical error loading plugin ${p.pluginId}:`,
          error
        );
      }
    }

    const rootRpcRouter: Record<string, unknown> = {};
    for (const [pluginId, router] of this.pluginRpcRouters.entries()) {
      rootRpcRouter[pluginId] = router;
    }

    const rpcHandler = new RPCHandler(
      rootRpcRouter as ConstructorParameters<typeof RPCHandler>[0]
    );

    rootRouter.all("/api/*", async (c) => {
      const pathname = new URL(c.req.raw.url).pathname;

      // Resolve core services for RPC context
      const auth = await this.getService(coreServices.auth);
      const logger = await this.getService(coreServices.logger);
      const db = await this.getService(coreServices.database);
      const fetch = await this.getService(coreServices.fetch);
      const healthCheckRegistry = await this.getService(
        coreServices.healthCheckRegistry
      );
      const queuePluginRegistry = await this.getService(
        coreServices.queuePluginRegistry
      );
      const queueFactory = await this.getService(coreServices.queueFactory);

      if (
        !auth ||
        !logger ||
        !db ||
        !fetch ||
        !healthCheckRegistry ||
        !queuePluginRegistry ||
        !queueFactory
      ) {
        return c.json({ error: "Core services not initialized" }, 500);
      }

      const user = await (auth as AuthService).authenticate(c.req.raw);

      const context: RpcContext = {
        auth: auth as AuthService,
        logger: logger as Logger,
        db: db as NodePgDatabase<Record<string, unknown>>,
        fetch: fetch as Fetch,
        healthCheckRegistry: healthCheckRegistry as HealthCheckRegistry,
        queuePluginRegistry: queuePluginRegistry as QueuePluginRegistry,
        queueFactory: queueFactory as QueueFactory,
        user,
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
      for (const [path, handler] of this.pluginHttpHandlers) {
        if (pathname.startsWith(path)) {
          return handler(c.req.raw);
        }
      }

      return c.json({ error: "Not Found" }, 404);
    });
  }

  private registerPlugin(
    backendPlugin: BackendPlugin,
    pluginPath: string,
    pendingInits: PendingInit[],
    providedBy: Map<string, string>
  ) {
    if (!backendPlugin || typeof backendPlugin.register !== "function") {
      rootLogger.warn(
        `Plugin ${
          backendPlugin?.pluginId || "unknown"
        } is not using new API. Skipping.`
      );
      return;
    }

    // Execute Register
    backendPlugin.register({
      registerInit: <
        D extends Deps,
        S extends Record<string, unknown> | undefined = undefined
      >(args: {
        deps: D;
        schema?: S;
        init: (
          deps: ResolvedDeps<D> &
            (S extends undefined
              ? unknown
              : { database: NodePgDatabase<NonNullable<S>> })
        ) => Promise<void>;
      }) => {
        pendingInits.push({
          pluginId: backendPlugin.pluginId,
          pluginPath: pluginPath,
          deps: args.deps,
          init: args.init as (deps: Record<string, unknown>) => Promise<void>,
          schema: args.schema,
        });
      },
      registerService: (ref: ServiceRef<unknown>, impl: unknown) => {
        this.registry.register(ref, impl);
        providedBy.set(ref.id, backendPlugin.pluginId);
        rootLogger.debug(`   -> Registered service '${ref.id}'`);
      },
      registerExtensionPoint: (ref, impl) => {
        this.registerExtensionPoint(ref, impl);
      },
      getExtensionPoint: (ref) => {
        return this.getExtensionPoint(ref);
      },
      registerPermissions: (permissions: Permission[]) => {
        this.registerPermissions(backendPlugin.pluginId, permissions);
      },
      registerRouter: (router: unknown) => {
        this.pluginRpcRouters.set(backendPlugin.pluginId, router);
      },
    });
  }

  async getService<T>(ref: ServiceRef<T>): Promise<T | undefined> {
    try {
      return await this.registry.get(ref, "core"); // Use 'core' as requester
    } catch {
      return undefined;
    }
  }

  registerService<T>(ref: ServiceRef<T>, impl: T) {
    this.registry.register(ref, impl);
  }
}
