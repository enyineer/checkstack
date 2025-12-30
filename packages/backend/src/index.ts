import { Hono } from "hono";
import { PluginManager } from "./plugin-manager";
import { logger } from "hono/logger";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db } from "./db";
import path from "node:path";
import fs from "node:fs";
import { rootLogger } from "./logger";
import { coreServices } from "@checkmate/backend-api";
import { plugins } from "./schema";
import { eq, and } from "drizzle-orm";
import { PluginLocalInstaller } from "./services/plugin-installer";
import { QueuePluginRegistryImpl } from "./services/queue-plugin-registry";
import { QueueFactoryImpl } from "./services/queue-factory";

import { cors } from "hono/cors";

const app = new Hono();
const pluginManager = new PluginManager();

app.use(
  "*",
  cors({
    origin: process.env.VITE_FRONTEND_URL || "http://localhost:5173",
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["POST", "GET", "PUT", "PATCH", "DELETE", "OPTIONS"],
    exposeHeaders: ["Content-Length"],
    maxAge: 600,
    credentials: true,
  })
);
app.use("*", logger());

app.get("/", (c) => {
  return c.text("Checkmate Core Backend is running!");
});

app.get("/api/plugins", async (c) => {
  // Only return remote plugins that need to be loaded via HTTP
  // Local plugins are bundled and loaded via Vite's glob import
  const enabledPlugins = await db
    .select({
      name: plugins.name,
      path: plugins.path,
    })
    .from(plugins)
    .where(
      and(
        eq(plugins.enabled, true),
        eq(plugins.type, "frontend"),
        eq(plugins.isUninstallable, true) // Only remote plugins
      )
    );

  return c.json(enabledPlugins);
});

app.get("/.well-known/jwks.json", async (c) => {
  const { keyStore } = await import("./services/keystore");
  const jwks = await keyStore.getPublicJWKS();
  return c.json(jwks);
});

const init = async () => {
  rootLogger.info("🚀 Starting Checkmate Core...");

  // Register Plugin Installer Service
  const installer = new PluginLocalInstaller(
    path.join(process.cwd(), "runtime_plugins")
  );
  pluginManager.registerService(coreServices.pluginInstaller, installer);

  // 1. Run Core Migrations
  rootLogger.info("🔄 Running core migrations...");
  try {
    await migrate(db, {
      migrationsFolder: path.join(process.cwd(), "drizzle"),
    });
    rootLogger.info("✅ Core migrations applied.");
  } catch (error) {
    throw new Error("❌ Failed to apply core migrations", {
      cause: error,
    });
  }

  // 1.5. Ensure JWKS signing keys exist
  rootLogger.info("🔑 Ensuring JWKS signing keys...");
  const { keyStore } = await import("./services/keystore");
  await keyStore.getSigningKey(); // This triggers generation if missing

  // 1.6. Create backend-scoped ConfigService for core services
  const { ConfigServiceImpl } = await import("./services/config-service");
  const configService = new ConfigServiceImpl("backend", db);

  // 1.7. Register Queue Services
  rootLogger.info("📋 Registering queue services...");
  const queueRegistry = new QueuePluginRegistryImpl();
  const queueFactory = new QueueFactoryImpl(
    queueRegistry,
    configService,
    rootLogger
  );
  pluginManager.registerService(
    coreServices.queuePluginRegistry,
    queueRegistry
  );
  pluginManager.registerService(coreServices.queueFactory, queueFactory);

  // Endpoint to install a new plugin
  app.post("/api/plugins/install", async (c) => {
    const { packageName } = await c.req.json();
    if (!packageName) return c.json({ error: "packageName is required" }, 400);

    try {
      const result = await installer.install(packageName);

      // Register in DB
      await db
        .insert(plugins)
        .values({
          name: result.name,
          path: result.path,
          enabled: true,
        })
        .onConflictDoUpdate({
          target: [plugins.name],
          set: { path: result.path, enabled: true },
        });

      return c.json({ success: true, plugin: result });
    } catch (error) {
      return c.json({ error: String(error) }, 500);
    }
  });

  // Serve static assets for runtime plugins
  // e.g. /assets/plugins/my-plugin/index.js -> runtime_plugins/node_modules/my-plugin/dist/index.js
  app.use("/assets/plugins/:pluginName/*", async (c, next) => {
    const pluginName = c.req.param("pluginName");
    // Find plugin in DB to get path
    const results = await db
      .select()
      .from(plugins)
      .where(eq(plugins.name, pluginName));
    const plugin = results[0];
    if (!plugin) return next();

    // We assume plugins are built into 'dist' folder
    const assetPath = c.req.path.split(`/assets/plugins/${pluginName}/`)[1];
    const filePath = path.join(plugin.path, "dist", assetPath);

    if (fs.existsSync(filePath)) {
      return c.body(fs.readFileSync(filePath));
    }
    return next();
  });

  // 3. Load Plugins
  await pluginManager.loadPlugins(app);

  // 4. Load Queue Configuration
  rootLogger.info("📋 Loading queue configuration...");
  await queueFactory.loadConfiguration();

  rootLogger.info("✅ Checkmate Core initialized.");
};

init();

export default {
  port: 3000,
  fetch: app.fetch,
};

export { jwtService } from "./services/jwt";
