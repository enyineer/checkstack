import type { Server } from "bun";
import { Hono } from "hono";
import { PluginManager } from "./plugin-manager";
import { logger } from "hono/logger";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db } from "./db";
import path from "node:path";
import fs from "node:fs";
import { rootLogger } from "./logger";
import { coreServices, coreHooks } from "@checkmate/backend-api";
import { plugins } from "./schema";
import { eq, and } from "drizzle-orm";
import { PluginLocalInstaller } from "./services/plugin-installer";
import { QueuePluginRegistryImpl } from "./services/queue-plugin-registry";
import { QueueManagerImpl } from "./services/queue-manager";
import {
  createWebSocketHandler,
  SignalServiceImpl,
  type WebSocketData,
} from "@checkmate/signal-backend";
import {
  PLUGIN_INSTALLED,
  PLUGIN_DEREGISTERED,
} from "@checkmate/signal-common";
import { createPluginAdminRouter } from "./plugin-manager/plugin-admin-router";

import { cors } from "hono/cors";

const app = new Hono();
const pluginManager = new PluginManager();

// WebSocket handler instance (initialized during init)
let wsHandler: ReturnType<typeof createWebSocketHandler> | undefined;

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
  rootLogger.debug("Registering queue services...");
  const queueRegistry = new QueuePluginRegistryImpl();
  const queueManager = new QueueManagerImpl(
    queueRegistry,
    configService,
    rootLogger
  );
  pluginManager.registerService(
    coreServices.queuePluginRegistry,
    queueRegistry
  );
  pluginManager.registerService(coreServices.queueManager, queueManager);

  // Serve static assets for runtime frontend plugins only
  // Backend plugins don't need public assets - only frontend plugins do
  // e.g. /assets/plugins/my-plugin-frontend/index.js -> runtime_plugins/node_modules/my-plugin-frontend/dist/index.js
  app.use("/assets/plugins/:pluginName/*", async (c, next) => {
    const pluginName = c.req.param("pluginName");
    // Find plugin in DB to get path
    const results = await db
      .select()
      .from(plugins)
      .where(eq(plugins.name, pluginName));
    const plugin = results[0];

    // Only serve assets for frontend plugins
    if (!plugin || plugin.type !== "frontend") {
      return next();
    }

    // We assume plugins are built into 'dist' folder
    const assetPath = c.req.path.split(`/assets/plugins/${pluginName}/`)[1];
    const filePath = path.join(plugin.path, "dist", assetPath);

    if (fs.existsSync(filePath)) {
      return c.body(fs.readFileSync(filePath));
    }
    return next();
  });

  // 2. Initialize Signal Service (before plugins so they can use it)
  // SignalService requires EventBus which is a lazy factory depending on QueueManager
  rootLogger.debug("Initializing signal service...");
  const eventBus = await pluginManager.getService(coreServices.eventBus);
  if (!eventBus) {
    throw new Error("EventBus not available - required for SignalService");
  }
  const signalService = new SignalServiceImpl(
    eventBus,
    rootLogger.child({ service: "SignalService" })
  );
  pluginManager.registerService(coreServices.signalService, signalService);

  // 3. Load Plugins
  await pluginManager.loadPlugins(app);

  // 4. Wire up auth client for permission-based signal filtering
  // This must happen AFTER plugins load so auth-backend is available
  const rpcClient = await pluginManager.getService(coreServices.rpcClient);
  if (rpcClient) {
    const { AuthApi } = await import("@checkmate/auth-common");
    const authClient = rpcClient.forPlugin(AuthApi);
    signalService.setAuthClient(authClient);
    rootLogger.debug(
      "SignalService: Auth client configured for permission filtering"
    );
  } else {
    rootLogger.warn(
      "SignalService: RpcClient not available, sendToAuthorizedUsers will be disabled"
    );
  }

  // 5. Register plugin admin router (core admin endpoints)
  const pluginAdminRouter = createPluginAdminRouter({
    pluginManager,
    installer,
  });
  // Register as core router - available at /api/core/
  pluginManager.registerCoreRouter("core", pluginAdminRouter);

  // 5. Setup lifecycle listeners for multi-instance coordination
  await pluginManager.setupLifecycleListeners();

  // 6. Load Queue Configuration AFTER plugins (queue plugins register first)
  rootLogger.info("📋 Loading queue configuration...");
  await queueManager.loadConfiguration();

  // 7. Start config polling for multi-instance coordination
  queueManager.startPolling(5000);

  // 9. Setup plugin lifecycle signal broadcasting to frontend
  // Only broadcast for frontend plugins (plugins ending with -frontend)
  await eventBus.subscribe(
    "core",
    coreHooks.pluginInstalled,
    async ({ pluginId }) => {
      // Only signal frontend plugin installations to the frontend
      if (!pluginId.endsWith("-frontend")) {
        rootLogger.debug(
          `Skipping PLUGIN_INSTALLED signal for non-frontend plugin: ${pluginId}`
        );
        return;
      }
      rootLogger.debug(`Broadcasting PLUGIN_INSTALLED signal for: ${pluginId}`);
      await signalService.broadcast(PLUGIN_INSTALLED, { pluginId });
    },
    { mode: "work-queue", workerGroup: "frontend-signal-installed" }
  );
  await eventBus.subscribe(
    "core",
    coreHooks.pluginDeregistered,
    async ({ pluginId }) => {
      // Only signal frontend plugin deregistrations to the frontend
      if (!pluginId.endsWith("-frontend")) {
        rootLogger.debug(
          `Skipping PLUGIN_DEREGISTERED signal for non-frontend plugin: ${pluginId}`
        );
        return;
      }
      rootLogger.debug(
        `Broadcasting PLUGIN_DEREGISTERED signal for: ${pluginId}`
      );
      await signalService.broadcast(PLUGIN_DEREGISTERED, { pluginId });
    },
    { mode: "work-queue", workerGroup: "frontend-signal-deregistered" }
  );

  // 11. Create WebSocket handler for realtime signals
  wsHandler = createWebSocketHandler({
    eventBus,
    logger: rootLogger.child({ service: "WebSocket" }),
  });

  rootLogger.info("✅ Checkmate Core initialized.");
};

void init();

// Custom fetch handler that handles WebSocket upgrades
const fetch = async (
  req: Request,
  server: Server<WebSocketData>
): Promise<Response | undefined> => {
  // Set the server reference for WebSocket pub/sub after startup
  if (wsHandler && !server.upgrade) {
    // Server doesn't support WebSocket upgrade (shouldn't happen with Bun)
    return app.fetch(req, server);
  }

  // Give the WebSocket handler the server reference if needed
  wsHandler?.setServer(server);

  const url = new URL(req.url);

  // Handle WebSocket upgrade for signals
  if (url.pathname === "/api/signals/ws") {
    // Try to authenticate, but allow anonymous connections for broadcast signals
    const authService = await pluginManager.getService(coreServices.auth);
    let userId: string | undefined;

    if (authService) {
      const user = await authService.authenticate(req);
      // Only RealUser (type: 'user') can have a private channel
      if (user?.type === "user") {
        userId = user.id;
      }
    }

    const success = server.upgrade(req, {
      data: {
        userId, // undefined for anonymous, set for authenticated users
        createdAt: Date.now(),
      },
    });

    return success
      ? undefined
      : new Response("WebSocket upgrade failed", { status: 500 });
  }

  // Handle regular HTTP requests with Hono
  return app.fetch(req, server);
};

export default {
  port: 3000,
  fetch,
  websocket: {
    // Type template for ws.data
    data: {} as WebSocketData,

    open(ws: import("bun").ServerWebSocket<WebSocketData>) {
      wsHandler?.websocket.open(ws);
    },

    message(
      ws: import("bun").ServerWebSocket<WebSocketData>,
      message: string | Buffer
    ) {
      wsHandler?.websocket.message(ws, message);
    },

    close(
      ws: import("bun").ServerWebSocket<WebSocketData>,
      code: number,
      reason: string
    ) {
      wsHandler?.websocket.close(ws, code, reason);
    },
  },
};

export { jwtService } from "./services/jwt";
