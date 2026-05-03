import type { Server } from "bun";
import { type Context, Hono } from "hono";
import { TrieRouter } from "hono/router/trie-router";
import { PluginManager } from "./plugin-manager";
import { logger } from "hono/logger";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db } from "./db";
import path from "node:path";
import fs from "node:fs";
import { rootLogger } from "./logger";
import { coreServices, coreHooks } from "@checkstack/backend-api";
import { extractErrorMessage } from "@checkstack/common";
import { plugins } from "./schema";
import { eq, and } from "drizzle-orm";
import { PluginLocalInstaller } from "./services/plugin-installer";
import { QueuePluginRegistryImpl } from "./services/queue-plugin-registry";
import { QueueManagerImpl } from "./services/queue-manager";
import { CachePluginRegistryImpl } from "./services/cache-plugin-registry";
import { CacheManagerImpl } from "./services/cache-manager";
import {
  createWebSocketHandler,
  SignalServiceImpl,
  type WebSocketData,
} from "@checkstack/signal-backend";
import type { WsConnectionHandlers } from "@checkstack/backend-api";

// =============================================================================
// SERVER-LEVEL WEBSOCKET DATA
// =============================================================================

/**
 * Discriminated union for all WebSocket connection types.
 * Signal connections are handled by signal-backend.
 * Plugin WS connections are routed via the generic WebSocket route registry.
 */
type ServerWsData =
  | ({ connectionType: "signal" } & WebSocketData)
  | {
      connectionType: "plugin";
      createdAt: number;
      pluginHandlers: WsConnectionHandlers;
      /** Mutable proxy — patched in open() to the real Bun WS */
      wsProxy: { send: (data: string) => void; close: () => void };
    };
import {
  PLUGIN_INSTALLED,
  PLUGIN_DEREGISTERED,
} from "@checkstack/signal-common";
import { createPluginAdminRouter } from "./plugin-manager/plugin-admin-router";
import {
  pluginMetadata as apiDocsMetadata,
  apiDocsAccess,
} from "@checkstack/api-docs-common";

import { cors } from "hono/cors";

// IMPORTANT: TrieRouter (not the default SmartRouter).
// SmartRouter freezes its matcher on the first incoming request — any later
// app.add() throws "Can not add a route since the matcher is already built".
// Plugins register routes asynchronously during init() and at runtime via
// loadSinglePlugin(), so we need an incremental router.
const app = new Hono({ router: new TrieRouter() });
const pluginManager = new PluginManager();

/**
 * Init lifecycle state.
 *
 * `initialized` flips to true after the entire init() completes (Phases 1-3).
 * It feeds the "core.init" readiness probe consumed by /ready.
 *
 * `initError` is populated when init throws; the process is then exited so
 * the supervisor (docker/k8s) restarts us — we never serve a half-initialized
 * backend.
 *
 * The HTTP request gate does NOT key off these flags directly. It awaits
 * `pluginManager.routesReadyPromise`, which resolves earlier — right after
 * `/api/:pluginId/*` is added to the root router and BEFORE `afterPluginsReady`
 * runs — so cross-plugin RPC calls during plugin boot don't deadlock on
 * themselves.
 */
let initError: Error | undefined;
let initialized = false;

/**
 * Maximum time a request will wait for init to complete before falling back
 * to a 503 Service Unavailable. Without this, a wedged plugin would hang
 * health probes forever.
 */
const READY_WAIT_TIMEOUT_MS = 30_000;

// WebSocket handler instance (initialized during init)
let wsHandler: ReturnType<typeof createWebSocketHandler> | undefined;

// CORS configuration
// - In production: uses BASE_URL
// - In development: allows both backend origin and Vite dev server
const corsOrigin = process.env.BASE_URL || "http://localhost:3000";
const corsOrigins = [corsOrigin];

// Allow Vite dev server in development
if (!process.env.BASE_URL || corsOrigin.includes("localhost")) {
  corsOrigins.push("http://localhost:5173");
}

app.use(
  "*",
  cors({
    origin: corsOrigins,
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["POST", "GET", "PUT", "PATCH", "DELETE", "OPTIONS"],
    exposeHeaders: ["Content-Length"],
    maxAge: 600,
    credentials: true,
  })
);
app.use("*", logger());

// =============================================================================
// PLATFORM ENDPOINTS — /.checkstack/*
// =============================================================================
//
// All "platform-level" endpoints (probes, future operator hooks) live under
// /.checkstack/* so they are clearly separated from plugin /api/*, runtime
// frontend assets, and the SPA wildcard. The leading dot keeps them out of
// any plugin URL space by construction.
//
// Health & readiness:
//   - registered at module load; bypass the boot gate in `fetch()` so that
//     orchestrators (Kubernetes, docker-compose) can probe a still-booting
//     process.
//   - /.checkstack/health = "process is alive"
//   - /.checkstack/ready  = "plugins initialized and all critical probes pass"

/** Liveness probe — answers as long as the process responds. */
app.get("/.checkstack/health", (c) => c.json({ status: "ok" }));

/**
 * Readiness probe — aggregates plugin-contributed checks.
 * - 503 while init is in flight or has failed
 * - 503 if any critical probe is failing
 * - 200 only when init completed AND all critical probes pass
 */
app.get("/.checkstack/ready", async (c) => {
  if (initError) {
    return c.json(
      { ready: false, error: initError.message, checks: [] },
      503,
      { "Retry-After": "5" },
    );
  }
  if (!initialized) {
    return c.json(
      { ready: false, reason: "initializing", checks: [] },
      503,
      { "Retry-After": "1" },
    );
  }
  const snapshot = await pluginManager.getReadinessRegistry().evaluate();
  return c.json(snapshot, snapshot.ready ? 200 : 503);
});

// SECURITY: Add missing standard security headers across all API responses
app.use("/api/*", async (c, next) => {
  await next();
  c.res.headers.set("X-Content-Type-Options", "nosniff");
  c.res.headers.set("X-Frame-Options", "DENY");
  c.res.headers.set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
  c.res.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
});

// Runtime config endpoint - returns BASE_URL for frontend
app.get("/api/config", (c) => {
  const baseUrl = process.env.BASE_URL || "http://localhost:3000";
  return c.json({ baseUrl });
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

// About endpoint - returns core version and loaded plugin versions
app.get("/api/about", async (c) => {
  // Read core backend version from package.json
  let coreVersion = "unknown";
  try {
    const corePkgPath = path.join(import.meta.dir, "..", "package.json");
    if (fs.existsSync(corePkgPath)) {
      const corePkg = JSON.parse(fs.readFileSync(corePkgPath, "utf8"));
      coreVersion = corePkg.version ?? "unknown";
    }
  } catch {
    rootLogger.debug("Failed to read core backend package.json for version");
  }

  // Read all enabled plugins with their versions from their package.json files
  const enabledPlugins = await db
    .select({
      name: plugins.name,
      path: plugins.path,
      type: plugins.type,
    })
    .from(plugins)
    .where(eq(plugins.enabled, true));

  const pluginInfos = enabledPlugins.map((plugin) => {
    let version = "unknown";
    try {
      const pkgJsonPath = path.join(plugin.path, "package.json");
      if (fs.existsSync(pkgJsonPath)) {
        const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
        version = pkgJson.version ?? "unknown";
      }
    } catch {
      // Plugin path may not have a readable package.json (e.g., remote plugins)
    }
    return {
      name: plugin.name,
      version,
      type: plugin.type,
    };
  });

  return c.json({
    coreVersion,
    plugins: pluginInfos,
  });
});

app.get("/.well-known/jwks.json", async (c) => {
  const { keyStore } = await import("./services/keystore");
  const jwks = await keyStore.getPublicJWKS();
  return c.json(jwks);
});

// Production: Serve frontend static files when CHECKSTACK_FRONTEND_DIST is set
// Must be registered at module load time before Hono's router is built
const frontendDistPath = process.env.CHECKSTACK_FRONTEND_DIST;
if (frontendDistPath && fs.existsSync(frontendDistPath)) {
  rootLogger.info(`📦 Serving frontend from: ${frontendDistPath}`);
  /** Serve a static file via Hono's context to preserve headers through middleware. */
  const serveFile = async (c: Context, filePath: string) => {
    const file = Bun.file(filePath);
    const content = await file.arrayBuffer();
    c.header("Content-Type", file.type);
    return c.body(content);
  };

  // Serve static assets (JS, CSS, images, etc.)
  // Fall through to next() on miss so plugin-asset routes (registered later
  // during init at /assets/plugins/:pluginName/*) get a chance to match.
  app.get("/assets/*", async (c, next) => {
    const assetPath = c.req.path.replace("/assets/", "");
    const filePath = path.join(frontendDistPath, "assets", assetPath);

    if (fs.existsSync(filePath)) {
      return serveFile(c, filePath);
    }
    return next();
  });

  // Serve vendor scripts (externalized React, react-router-dom, etc.)
  app.get("/vendor/*", async (c) => {
    const vendorPath = c.req.path.replace("/vendor/", "");
    const filePath = path.join(frontendDistPath, "vendor", vendorPath);

    if (fs.existsSync(filePath)) {
      return serveFile(c, filePath);
    }
    return c.notFound();
  });

  // Serve root-level static files (e.g., /favicon.svg) from the dist directory
  // before the SPA fallback, so they don't get caught by the index.html handler
  app.get("*", async (c, next) => {
    // Skip API and WebSocket routes - let them pass through to actual handlers
    if (c.req.path.startsWith("/api")) {
      return next();
    }

    // Check if the request maps to an actual file in the dist root
    // (e.g., /favicon.svg -> dist/favicon.svg)
    const reqPath = c.req.path.slice(1); // Remove leading "/"
    if (reqPath && reqPath !== "" && !reqPath.includes("..")) {
      const staticFilePath = path.join(frontendDistPath, reqPath);
      // Only serve if it's a file (not a directory) and exists
      if (fs.existsSync(staticFilePath) && fs.statSync(staticFilePath).isFile()) {
        return serveFile(c, staticFilePath);
      }
    }

    // SPA fallback: serve index.html for all remaining non-API routes
    const indexPath = path.join(frontendDistPath, "index.html");
    if (fs.existsSync(indexPath)) {
      return serveFile(c, indexPath);
    }
    return c.notFound();
  });
}

const init = async () => {
  rootLogger.info("🚀 Starting Checkstack Core...");

  // Register Plugin Installer Service
  const installer = new PluginLocalInstaller(
    path.join(process.cwd(), "runtime_plugins")
  );
  pluginManager.registerService(coreServices.pluginInstaller, installer);

  // 1. Run Core Migrations
  rootLogger.info("🔄 Running core migrations...");
  try {
    await migrate(db, {
      // Use import.meta.dir to find migrations relative to this file (works in Docker)
      migrationsFolder: path.join(import.meta.dir, "..", "drizzle"),
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

  // 1.8. Register Cache Services
  rootLogger.debug("Registering cache services...");
  const cacheRegistry = new CachePluginRegistryImpl();
  const cacheManager = new CacheManagerImpl(
    cacheRegistry,
    configService,
    rootLogger
  );
  pluginManager.registerService(
    coreServices.cachePluginRegistry,
    cacheRegistry
  );
  pluginManager.registerService(coreServices.cacheManager, cacheManager);

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

  // 2.5. Register OpenAPI endpoint BEFORE plugins load
  // Must be registered before /api/:pluginId/* catch-all route
  const authService = await pluginManager.getService(coreServices.auth);
  if (authService) {
    const { createOpenApiHandler } = await import("./openapi-router");
    const baseUrl = process.env.BASE_URL || "http://localhost:3000";
    const openApiHandler = createOpenApiHandler({
      pluginManager,
      authService,
      baseUrl,
      requiredAccessRule: `${apiDocsMetadata.pluginId}.${apiDocsAccess.view.id}`,
    });
    app.get("/api/openapi.json", async (c) => {
      const response = await openApiHandler(c.req.raw);
      return c.newResponse(response.body, response);
    });
    rootLogger.debug("OpenAPI endpoint registered at /api/openapi.json");
  } else {
    rootLogger.warn(
      "AuthService not available, OpenAPI endpoint will not be registered"
    );
  }

  // 3. Load Plugins
  await pluginManager.loadPlugins(app);

  // 4. Wire up auth client for access-based signal filtering
  // This must happen AFTER plugins load so auth-backend is available
  const rpcClient = await pluginManager.getService(coreServices.rpcClient);
  if (rpcClient) {
    const { AuthApi } = await import("@checkstack/auth-common");
    const authClient = rpcClient.forPlugin(AuthApi);
    signalService.setAuthClient(authClient);
    rootLogger.debug(
      "SignalService: Auth client configured for access filtering"
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

  // 8. Load Cache Configuration AFTER plugins (cache plugins register first)
  rootLogger.info("📦 Loading cache configuration...");
  await cacheManager.loadConfiguration();

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

  // Register the core "init" readiness probe. Plugin-contributed probes are
  // additive — see coreServices.readinessRegistry for the plugin-facing API.
  pluginManager.getReadinessRegistry().register({
    name: "core.init",
    critical: true,
    check: async () => ({ ok: initialized, message: initialized ? undefined : "init not complete" }),
  });

  rootLogger.info("✅ Checkstack Core initialized.");
};

/**
 * Fire-and-forget init. We deliberately don't `await` at the top level so the
 * server can answer /health and /ready while plugins are still loading;
 * non-bypass requests are gated via `waitForRoutesReady()` below.
 */
// eslint-disable-next-line unicorn/prefer-top-level-await -- intentionally non-blocking; gates handled in waitForRoutesReady()
void (async () => {
  try {
    await init();
    initialized = true;
  } catch (error: unknown) {
    initError = new Error(extractErrorMessage(error, "init failed"));
    rootLogger.error(
      "❌ FATAL: Checkstack Core init failed; the process will exit so the supervisor can restart it.",
      initError,
    );
    // Give the logger one tick to flush, then exit so docker/k8s restarts us.
    // A half-initialized backend silently serves broken state — restart is
    // strictly better than continuing. We disable the no-process-exit rule
    // because this IS the canonical fail-fast pattern for a long-running
    // server entrypoint.
    setTimeout(() => {
      // eslint-disable-next-line unicorn/no-process-exit -- intentional fail-fast on init failure
      process.exit(1);
    }, 50);
  }
})();

/**
 * Paths that bypass the boot gate. Platform endpoints under /.checkstack/*
 * MUST be reachable while the backend is still booting so orchestrators can
 * probe it. Everything else waits until plugin routes are registered.
 */
const BOOT_BYPASS_PREFIX = "/.checkstack/";

/**
 * Wait until plugin RPC routes are registered on the root router (resolved
 * inside `loadPlugins` BEFORE Phase 2 / `afterPluginsReady`). Returns:
 *   - undefined when routes are ready → caller should proceed to Hono.
 *   - a 503 Response when init failed or the wait timed out.
 *
 * Why this gate, and why at this specific point:
 *   - Earlier (before /api/:pluginId/* is added), an incoming request would
 *     short-circuit through the SPA wildcard or 404 because the plugin route
 *     simply doesn't exist yet on the router.
 *   - Later (after full init), self-referencing RPC calls made from
 *     `afterPluginsReady` would deadlock waiting for init to complete — so
 *     we MUST open the gate before Phase 3 runs.
 *   - `loadPlugins()` resolves `routesReadyPromise` immediately after
 *     `registerApiRoute()`, which is the earliest point both conditions hold.
 */
async function waitForRoutesReady(): Promise<Response | undefined> {
  if (initError) {
    return Response.json(
      { error: "Backend init failed", message: initError.message },
      { status: 503, headers: { "Retry-After": "5" } },
    );
  }
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  // pluginManager.routesReadyPromise resolves from inside loadPlugins; it
  // never rejects. The init catch handler logs + process.exit's separately.
  const timedOut = await Promise.race([
    pluginManager.routesReadyPromise.then(() => false),
    new Promise<true>((resolve) => {
      timeoutHandle = setTimeout(() => resolve(true), READY_WAIT_TIMEOUT_MS);
    }),
  ]);
  if (timeoutHandle) clearTimeout(timeoutHandle);
  if (timedOut) {
    return Response.json(
      { error: "Backend not ready", message: "boot timeout" },
      { status: 503, headers: { "Retry-After": "5" } },
    );
  }
  // Re-read after await — init may have rejected while we were waiting.
  const errAfter = initError as Error | undefined;
  if (errAfter) {
    return Response.json(
      { error: "Backend init failed", message: errAfter.message },
      { status: 503, headers: { "Retry-After": "5" } },
    );
  }
  return undefined;
}

// Custom fetch handler that handles WebSocket upgrades
const fetch = async (
  req: Request,
  server: Server<ServerWsData>
): Promise<Response | undefined> => {
  const url = new URL(req.url);

  // Platform endpoints (/.checkstack/*) bypass the boot gate so orchestrators
  // can poll a booting process. Everything else waits until plugin routes
  // are registered on the root router (resolved before Phase 2 init runs).
  if (!url.pathname.startsWith(BOOT_BYPASS_PREFIX)) {
    const stalled = await waitForRoutesReady();
    if (stalled) return stalled;
  }

  // Set the server reference for WebSocket pub/sub after startup
  if (wsHandler && !server.upgrade) {
    // Server doesn't support WebSocket upgrade (shouldn't happen with Bun)
    return app.fetch(req, server);
  }

  // Give the WebSocket handler the server reference if needed
  // Cast is safe: signal handler only reads its own fields via connectionType guard
  wsHandler?.setServer(server as unknown as Server<WebSocketData>);

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
        connectionType: "signal" as const,
        userId, // undefined for anonymous, set for authenticated users
        createdAt: Date.now(),
      },
    });

    return success
      ? undefined
      : new Response("WebSocket upgrade failed", { status: 500 });
  }

  // Handle WebSocket upgrade for plugin-registered routes (/api/ws/*)
  const WS_PREFIX = "/api/ws/";
  if (url.pathname.startsWith(WS_PREFIX)) {
    const pluginPath = url.pathname.slice(WS_PREFIX.length);
    const handler = pluginManager.getWsStore().getHandler(pluginPath);
    if (!handler) {
      return new Response("Not Found", { status: 404 });
    }

    // Mutable WsConnection proxy — starts as no-op, patched in open() to the real Bun WS.
    // The handler captures this object reference, so patching its methods works.
    const wsProxy = {
      send: (_: string) => {},
      close: () => {},
    };
    const pluginHandlers = handler.onConnection(wsProxy);

    const success = server.upgrade(req, {
      data: {
        connectionType: "plugin" as const,
        createdAt: Date.now(),
        pluginHandlers,
        wsProxy,
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
    data: {} as ServerWsData,

    open(ws: import("bun").ServerWebSocket<ServerWsData>) {
      if (ws.data.connectionType === "plugin") {
        // Patch the mutable proxy to wire through to the real Bun WebSocket
        ws.data.wsProxy.send = (data: string) => ws.send(data);
        ws.data.wsProxy.close = () => ws.close();
        return;
      }
      // Signal connection
      wsHandler?.websocket.open(
        ws as unknown as import("bun").ServerWebSocket<WebSocketData>,
      );
    },

    message(
      ws: import("bun").ServerWebSocket<ServerWsData>,
      message: string | Buffer,
    ) {
      if (ws.data.connectionType === "plugin") {
        void ws.data.pluginHandlers.onMessage(message.toString());
        return;
      }
      wsHandler?.websocket.message(
        ws as unknown as import("bun").ServerWebSocket<WebSocketData>,
        message,
      );
    },

    close(
      ws: import("bun").ServerWebSocket<ServerWsData>,
      code: number,
      reason: string,
    ) {
      if (ws.data.connectionType === "plugin") {
        ws.data.pluginHandlers.onClose();
        return;
      }
      wsHandler?.websocket.close(
        ws as unknown as import("bun").ServerWebSocket<WebSocketData>,
        code,
        reason,
      );
    },
  },
};

export { jwtService } from "./services/jwt";
