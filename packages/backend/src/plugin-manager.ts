import { drizzle, NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import path from "node:path";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { adminPool, db } from "./db";
import { plugins } from "./schema";
import { eq } from "drizzle-orm";
import { ServiceRegistry } from "./services/service-registry";
import {
  coreServices,
  BackendPlugin,
  ServiceRef,
  Deps,
  ResolvedDeps,
  Permission,
} from "@checkmate/backend-api";
import { rootLogger } from "./logger";
import { jwtService } from "./services/jwt";
import { CoreHealthCheckRegistry } from "./services/health-check-registry";

export class PluginManager {
  private registry = new ServiceRegistry();

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
  }

  async loadPluginsFromDb(rootRouter: Hono) {
    // Register Router Factory now that we have rootRouter
    this.registry.registerFactory(coreServices.httpRouter, (pluginId) => {
      const pluginRouter = new Hono();
      rootRouter.route(`/api/${pluginId}`, pluginRouter);
      return pluginRouter;
    });

    // Register Logger Factory
    this.registry.registerFactory(coreServices.logger, (pluginId) => {
      return rootLogger.child({ plugin: pluginId });
    });

    // Register Auth Factory (Scoped)
    this.registry.registerFactory(coreServices.fetch, (pluginId) => {
      return {
        fetch: async (input, init) => {
          // Sign token with scoped service name
          const token = await jwtService.sign({ service: pluginId }, "5m");
          const headers = new Headers(init?.headers);
          headers.set("Authorization", `Bearer ${token}`);
          return fetch(input, { ...init, headers });
        },
      };
    });

    // Register Health Check Registry (Global Singleton)
    const healthCheckRegistry = new CoreHealthCheckRegistry();
    this.registry.registerFactory(
      coreServices.healthCheckRegistry,
      () => healthCheckRegistry
    );

    // Register Permission Check Factory (Scoped)
    this.registry.registerFactory(coreServices.permissionCheck, (pluginId) => {
      return (permission: string) => {
        return createMiddleware(async (c, next) => {
          // Resolve Authentication Service (Late Binding)
          const authService = await this.registry.get(
            coreServices.authentication,
            pluginId
          );

          if (!authService) {
            // If no auth backend registered, everything is unauthorized?
            // Or maybe we skip check? Secure default: Block.
            return c.text("Authentication Service not available", 500);
          }

          const user = await authService.validate(c.req.raw);
          if (!user) {
            return c.text("Unauthorized", 401);
          }

          const userPermissions = user.permissions || [];
          const fullId = `${pluginId}.${permission}`;

          if (
            !userPermissions.includes("*") &&
            !userPermissions.includes(fullId)
          ) {
            return c.text(`Forbidden: Missing ${fullId}`, 403);
          }

          await next();
        });
      };
    });

    rootLogger.info("🔍 Scanning for plugins in database...");

    const enabledPlugins = await db
      .select()
      .from(plugins)
      .where(eq(plugins.enabled, true));

    if (enabledPlugins.length === 0) {
      rootLogger.info("ℹ️  No enabled plugins found.");
      return;
    }

    // Phase 1: Load Modules & Register Services
    const pendingInits: {
      pluginId: string;
      pluginPath: string;
      deps: Record<string, ServiceRef<unknown>>;
      init: (deps: Record<string, unknown>) => Promise<void>;
      schema?: Record<string, unknown>;
    }[] = [];

    const providedBy = new Map<string, string>(); // ServiceId -> PluginId

    for (const plugin of enabledPlugins) {
      rootLogger.info(`🔌 Loading module ${plugin.name}...`);

      let pluginModule;
      try {
        try {
          pluginModule = await import(plugin.name);
        } catch {
          pluginModule = await import(plugin.path);
        }

        const backendPlugin: BackendPlugin = pluginModule.default;

        if (!backendPlugin || typeof backendPlugin.register !== "function") {
          // Fallback for legacy plugins? Or just error.
          // For now, assume migration.
          rootLogger.warn(
            `Plugin ${plugin.name} is not using new API. Skipping.`
          );
          continue;
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
              pluginPath: plugin.path, // Retained pluginPath
              deps: args.deps,
              init: args.init as (
                deps: Record<string, unknown>
              ) => Promise<void>,
              schema: args.schema,
            });
          },
          registerService: (ref: ServiceRef<unknown>, impl: unknown) => {
            this.registry.register(ref, impl);
            providedBy.set(ref.id, backendPlugin.pluginId);
            rootLogger.debug(`   -> Registered service '${ref.id}'`);
          },
          registerPermissions: (permissions: Permission[]) => {
            const prefixed = permissions.map((p) => ({
              ...p,
              id: `${backendPlugin.pluginId}.${p.id}`,
            }));
            rootLogger.info(
              `   -> Registered ${prefixed.length} permissions for ${backendPlugin.pluginId}`
            );
            // TODO: Store these in a database or central registry
          },
        });
      } catch (error) {
        rootLogger.error(`Failed to load module for ${plugin.name}:`, error);
      }
    }

    // Phase 2: Initialize Plugins (Topological Sort)
    rootLogger.debug("🔄 Calculating initialization order...");

    const inDegree = new Map<string, number>();
    const graph = new Map<string, string[]>(); // Dependency -> Dependents

    // Initialize graph nodes
    for (const p of pendingInits) {
      inDegree.set(p.pluginId, 0);
      graph.set(p.pluginId, []);
    }

    // Build Graph
    for (const p of pendingInits) {
      const consumerId = p.pluginId;
      for (const [, ref] of Object.entries(p.deps)) {
        const serviceId = (ref as ServiceRef<unknown>).id;
        const providerId = providedBy.get(serviceId);

        // If the service is provided by another plugin (and not the consumer itself)
        if (providerId && providerId !== consumerId) {
          // Edge: Provider -> Consumer
          if (!graph.has(providerId)) {
            graph.set(providerId, []);
          }
          graph.get(providerId)!.push(consumerId);
          inDegree.set(consumerId, (inDegree.get(consumerId) || 0) + 1);
        }
      }
    }

    // Sort using Kahn's Algorithm
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
      rootLogger.error(
        "❌ Circular dependency detected or failed to sort plugins."
      );
      // For now, fail hard to prevent partial startup state
      throw new Error("Circular dependency detected");
    }

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
        try {
          await migrate(pluginDb, { migrationsFolder });
        } catch (error) {
          rootLogger.error(
            `❌ Failed migration of plugin ${p.pluginId}:`,
            error
          );
        }

        // Resolve Dependencies
        const resolvedDeps: Record<string, unknown> = {};
        for (const [key, ref] of Object.entries(p.deps)) {
          // If schema is present, we skip the standard database resolution
          // because we will inject the schema-aware DB.
          if (key === "database") {
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
            } else {
              resolvedDeps["database"] = pluginDb;
            }
          }

          resolvedDeps[key] = await this.registry.get(
            ref as ServiceRef<unknown>,
            p.pluginId
          );
        }

        try {
          await p.init(resolvedDeps);
          rootLogger.info(`   -> Initialized ${p.pluginId}`);
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
  }
  async getService<T>(ref: ServiceRef<T>): Promise<T | undefined> {
    try {
      return await this.registry.get(ref, "core"); // Use 'core' as requester
    } catch {
      return undefined;
    }
  }
}
