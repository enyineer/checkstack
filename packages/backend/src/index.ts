import { Hono } from "hono";
import { PluginManager } from "./plugin-manager";
import { logger } from "hono/logger";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db } from "./db";
import path from "node:path";
import fs from "node:fs";
import { jwtService } from "./services/jwt";
import { rootLogger } from "./logger";
import { coreServices } from "@checkmate/backend-api";
import { plugins } from "./schema";
import { eq, and } from "drizzle-orm";
import { PluginLocalInstaller } from "./services/plugin-installer";

import { cors } from "hono/cors";

const app = new Hono();
const pluginManager = new PluginManager();

app.use(
  "*",
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:5173",
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["POST", "GET", "OPTIONS"],
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
  const enabledPlugins = await db
    .select({
      name: plugins.name,
    })
    .from(plugins)
    .where(and(eq(plugins.enabled, true), eq(plugins.type, "frontend")));

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

  // 2. Signature Verification Middleware
  // Verify that every request coming to /api/* has a valid signature, unless exempt.
  // The 'auth-backend' plugin routes (/api/auth/*) must be exempt to allow login/signup.
  // The '/api/plugins' route is exempt to allow frontend bootstrapping.
  const EXEMPT_PATHS = [
    "/api/auth-backend",
    "/api/plugins",
    "/api/plugins/install",
  ];

  app.use("/api/*", async (c, next) => {
    const path = c.req.path;

    // Check exemptions (prefix match)
    if (EXEMPT_PATHS.some((p) => path.startsWith(p))) {
      return next();
    }

    const token = c.req.header("Authorization")?.replace("Bearer ", "");

    if (!token) {
      return c.json(
        { error: "Unauthorized: Missing Authorization header" },
        401
      );
    }

    // 5. Dual Authentication Strategy
    // Strategy A: Service Token (Stateless, signed by Core)
    const payload = await jwtService.verify(token);
    if (payload) {
      // It's a valid Service Token
      return next();
    }

    // Strategy B: User Token (Stateful, validated by Auth Plugin)
    // We try to retrieve the registered AuthenticationStrategy
    const authStrategy = await pluginManager.getService(
      coreServices.authentication
    );

    if (authStrategy) {
      const user = await authStrategy.validate(c.req.raw);
      if (user) {
        // It's a valid User Session
        return next();
      }
    }

    // Both failed
    return c.json({ error: "Unauthorized: Invalid token or session" }, 401);
  });

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

  rootLogger.info("✅ Checkmate Core initialized.");
};

init();

export default {
  port: 3000,
  fetch: app.fetch,
};

export { jwtService } from "./services/jwt";
