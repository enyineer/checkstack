import type { Server } from "bun";
import { type Context, Hono } from "hono";
import { TrieRouter } from "hono/router/trie-router";
import { PluginManager } from "./plugin-manager";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db } from "./db";
import path from "node:path";
import fs from "node:fs";
import { rootLogger } from "./logger";
import {
  coreServices,
  coreHooks,
  publicHostResolverExtensionPoint,
  publicPathExtensionPoint,
  parseInstanceNamespace,
  createInstanceRuntime,
  type PublicHostMatch,
} from "@checkstack/backend-api";
import { extractErrorMessage } from "@checkstack/common";
import {
  createPublicHostRegistry,
  normalizeHost,
} from "./public-host/registry";
import { createHostRoutingMiddleware } from "./public-host/middleware";
import { createCorsOriginResolver } from "./public-host/cors";
import { injectBootstrap } from "./bootstrap-html";
import { plugins } from "./schema";
import { eq, and } from "drizzle-orm";
import { QueuePluginRegistryImpl } from "./services/queue-plugin-registry";
import { QueueManagerImpl } from "./services/queue-manager";
import { CachePluginRegistryImpl } from "./services/cache-plugin-registry";
import { CacheManagerImpl } from "./services/cache-manager";
import { PostgresPluginArtifactStore } from "./services/plugin-artifact-store";
import { DefaultPluginInstallerRegistry } from "./services/plugin-installers/installer-registry";
import { PluginEventRecorder } from "./services/plugin-event-recorder";
import { createPluginManagerRouter } from "./services/plugin-manager-router";
import {
  pluginManagerAccessRules,
  pluginMetadata as pluginManagerMetadata,
  pluginManagerAccess,
} from "@checkstack/pluginmanager-common";
import {
  extractPackageJson,
  tryExtractBundle,
  MAX_TARBALL_SIZE_BYTES,
} from "./services/plugin-installers/tarball-utils";
import {
  createWebSocketHandler,
  SignalServiceImpl,
  type WebSocketData,
} from "@checkstack/signal-backend";
import type {
  BackendPlugin,
  WsConnectionHandlers,
} from "@checkstack/backend-api";
import { createDevAuthService } from "./services/dev-auth";

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
import {
  pluginMetadata as apiDocsMetadata,
  apiDocsAccess,
} from "@checkstack/api-docs-common";

import { cors } from "hono/cors";
import { startMetrics, registerQueueInstruments } from "./instrumentation-sdk";

// Start OpenTelemetry metrics export FIRST (before plugins init / migrations),
// so early queries are counted. No-op unless CHECKSTACK_METRICS_ENABLED is set;
// the exporter runs its own localhost Prometheus server, not an app route.
startMetrics();

// IMPORTANT: TrieRouter (not the default SmartRouter).
// SmartRouter freezes its matcher on the first incoming request — any later
// app.add() throws "Can not add a route since the matcher is already built".
// Plugins register routes asynchronously during init() and at runtime via
// loadSinglePlugin(), so we need an incremental router.
const app = new Hono({ router: new TrieRouter() });
const pluginManager = new PluginManager();

// Registry of plugin-contributed public-host resolvers (custom domains). The
// platform OWNS it and consults it from the host-routing middleware below;
// owning plugins contribute their resolver via `publicHostResolverExtensionPoint`
// (buffered until set, so registration order does not matter).
const publicHostRegistry = createPublicHostRegistry();
pluginManager.registerExtensionPoint(
  publicHostResolverExtensionPoint,
  publicHostRegistry.extensionPoint,
);

// Same-origin public path prefixes (e.g. `/statuspage/view`) contributed by
// owning plugins. Surfaced to the frontend via `/api/config` + the inlined boot
// blob so the SPA entry loads the LEAN public bundle for these paths instead of
// booting the admin app. The platform never interprets the prefixes.
const publicPathPrefixes: string[] = [];

// Which INSTANCE this backend runs as. The default instance carries the empty
// namespace; a non-empty `CHECKSTACK_INSTANCE_NAMESPACE` (validated/normalized
// here, failing fast if malformed) marks a secondary instance (e.g. the
// PR-preview instance) that must namespace all shared-infra state. Surfaced to
// the frontend via `/api/config` and registered as `coreServices.instanceRuntime`
// so every plugin can namespace accordingly.
const instanceNamespace = parseInstanceNamespace(
  process.env.CHECKSTACK_INSTANCE_NAMESPACE,
);

pluginManager.registerExtensionPoint(publicPathExtensionPoint, {
  registerPublicPath: ({ pathPrefix }) => {
    if (!publicPathPrefixes.includes(pathPrefix)) {
      publicPathPrefixes.push(pathPrefix);
    }
  },
});

/** The app's own host (from BASE_URL); requests on it skip host resolution. */
const primaryHost = normalizeHost(
  new URL(process.env.BASE_URL || "http://localhost:3000").host,
);

/**
 * Resolve the public surface for this request's `Host`, or null when the host
 * is the primary app host or not a configured public domain. Cached, so the
 * config endpoint and SPA fallback can both consult it cheaply.
 */
async function matchPublicHost(c: Context): Promise<PublicHostMatch | null> {
  const host = normalizeHost(c.req.header("host"));
  if (!host || host === primaryHost) return null;
  return publicHostRegistry.resolve(host);
}

/** A proxy may send a comma-list in x-forwarded-*; take the first hop. */
function firstForwardedHop(v: string | undefined): string | undefined {
  return v?.split(",")[0]?.trim();
}

/**
 * The origin a request actually arrived on (honoring the edge's forwarding
 * headers). On a public host this is the custom domain itself — the public
 * bundle MUST use it as its API base so every call stays on THIS locked-down
 * origin, never the admin origin.
 */
function requestOrigin(c: Context): string {
  const proto = (firstForwardedHop(c.req.header("x-forwarded-proto")) ?? "https").toLowerCase();
  const rawHost =
    firstForwardedHop(c.req.header("x-forwarded-host")) ??
    c.req.header("host") ??
    "";
  // Normalize away a REDUNDANT default port so the derived origin is stable
  // across proxy variance (`:443` on https / `:80` on http would otherwise make
  // the bundle's baseUrl differ from the browser origin and re-fire the probe).
  const [hostname, port] = rawHost.split(":");
  const redundantPort =
    (proto === "https" && port === "443") || (proto === "http" && port === "80");
  const host = redundantPort ? (hostname ?? "") : rawHost;
  return `${proto}://${host}`;
}

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

/**
 * Bounded dynamic CORS origin check. Admits the static allow-list (admin
 * BASE_URL + the Vite dev origin) AND any resolved/configured custom-domain
 * public host, so a request whose Origin is a status-page custom domain is not
 * rejected. The host is attacker-controlled, so resolution stays bounded via the
 * registry's cached, size-capped lookup (never an unbounded per-Origin DB hit),
 * and an unresolved Origin is denied. Non-CORS (same-origin) requests carry no
 * Origin and are unaffected. The decision itself lives in `./public-host/cors`
 * so it is unit-testable and cannot drift from the e2e assertions.
 */
const resolveCorsOrigin = createCorsOriginResolver({
  staticOrigins: corsOrigins,
  primaryHost,
  registry: publicHostRegistry,
});

app.use(
  "*",
  cors({
    origin: (origin) => resolveCorsOrigin(origin),
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["POST", "GET", "PUT", "PATCH", "DELETE", "OPTIONS"],
    exposeHeaders: ["Content-Length"],
    maxAge: 600,
    credentials: true,
  })
);
// Request/response logging through our rootLogger (winston) instead of
// hono/logger which bypasses winston and writes to stdout directly. Goes
// at debug level for healthy responses; warn for 4xx and error for 5xx so
// failures surface even with low verbosity. The 5xx branch additionally
// peeks the response body so the underlying error message lands in the
// log — Hono returns errors as JSON via `c.json({error}, 500)` which the
// default access log strips down to just the status code.
app.use("*", async (c, next) => {
  const start = performance.now();
  const method = c.req.method;
  const path = c.req.path;
  rootLogger.debug(`<-- ${method} ${path}`);
  await next();
  const elapsedMs = (performance.now() - start).toFixed(1);
  const status = c.res.status;
  const line = `--> ${method} ${path} ${status} ${elapsedMs}ms`;

  if (status >= 500) {
    let body: string | undefined;
    try {
      // Clone so the response stream remains consumable downstream.
      body = await c.res.clone().text();
    } catch {
      // ignore — best-effort body capture only
    }
    rootLogger.error(body ? `${line} — ${body}` : line);
  } else if (status >= 400) {
    rootLogger.warn(line);
  } else {
    rootLogger.debug(line);
  }
});

// =============================================================================
// PUBLIC CUSTOM-DOMAIN HOST ROUTING
// =============================================================================
//
// A status page (or any plugin-owned public surface) can be served on its own
// host, e.g. `status.acme.com`. On such a host we expose ONLY the public
// surface: the resolver's allow-listed API path(s) plus `/api/config`, the
// public bundle's static assets, and the public bundle itself. EVERYTHING else
// under `/api`, all of `/rest`, and the admin docs are 404'd, and navigational
// routes serve the SEPARATE public bundle (never the admin SPA shell — see the
// SPA fallback below).
//
// TLS for these hosts is terminated at the edge (ingress / on-demand-TLS proxy);
// the on-demand path is gated by `/.well-known/checkstack/authorize-domain`.
//
// Requests on the primary host (and any unknown host) skip resolution entirely,
// so this adds ~one string compare to the hot path; only configured custom
// domains pay for a (cached) lookup.
app.use(
  "*",
  createHostRoutingMiddleware({ registry: publicHostRegistry, primaryHost }),
);

/**
 * On-demand-TLS authorization hook. An edge proxy that issues certificates on
 * demand (Caddy `on_demand_tls` `ask`, Cloudflare for SaaS, a cert-manager
 * automation, ...) calls this to confirm a host is a CONFIGURED public domain
 * BEFORE minting a certificate, so the platform never causes certs to be minted
 * for arbitrary hosts. Returns 200 for the primary host or any resolved public
 * domain, 404 otherwise. Public + unauthenticated; reveals only yes/no for the
 * single queried host.
 */
app.get("/.well-known/checkstack/authorize-domain", async (c) => {
  const host = normalizeHost(c.req.query("domain") ?? c.req.header("host"));
  if (!host) return c.notFound();
  if (host === primaryHost) return c.text("ok");
  const match = await publicHostRegistry.resolve(host);
  return match ? c.text("ok") : c.notFound();
});

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

// Runtime config endpoint - returns BASE_URL for frontend. On a custom-domain
// public host it ALSO returns `publicHost` (the resolver's opaque bootstrap
// hint, e.g. `{ kind: "status-page", slug }`) so the public bundle knows what
// to render without a URL path. This is one of the two endpoints allow-listed
// on a public host.
app.get("/api/config", async (c) => {
  const match = await matchPublicHost(c);
  if (match) {
    // CRITICAL: on a public host the bundle must talk ONLY to this (locked-down)
    // origin. Returning the admin BASE_URL here would point the bundle's RPC
    // client at the unrestricted admin origin and defeat the host allow-list.
    return c.json({ baseUrl: requestOrigin(c), publicHost: match.bootstrap });
  }
  const baseUrl = process.env.BASE_URL || "http://localhost:3000";
  // On the primary (admin) origin, advertise the public path prefixes so the
  // SPA entry can load the lean public bundle for e.g. `/statuspage/view/:slug`.
  // A non-empty instance namespace is advertised too so the admin SPA can show
  // the "preview instance" banner; the default instance omits it.
  return c.json({
    baseUrl,
    publicPathPrefixes,
    ...(instanceNamespace ? { instanceNamespace } : {}),
  });
});

/**
 * The remote (installed) frontend plugins the host must load over HTTP as
 * Module Federation remotes. Local plugins are bundled and loaded via Vite's
 * glob import, so they are excluded here. Shared by the `/api/plugins` endpoint
 * and the inlined HTML bootstrap (see the SPA fallback below) so both return
 * the exact same list.
 */
const getEnabledRemoteFrontendPlugins = () =>
  db
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

app.get("/api/plugins", async (c) => {
  return c.json(await getEnabledRemoteFrontendPlugins());
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

// Serve the in-app user guide: the SAME Astro Starlight static build deployed
// to GitHub Pages, mounted same-origin at `/checkstack/*` (the docs build has
// `base: "/checkstack"` and all cross-links are `/checkstack/...`, so it works
// verbatim - no rebuild, no link rewriting). Registered BEFORE the SPA
// catch-all below so doc paths win; gated on the dist existing so a deployment
// without docs degrades gracefully (the path 404s as before). Note: this is
// `/checkstack/*`, distinct from the platform's `/.checkstack/*` (leading dot).
const docsDistPath =
  process.env.CHECKSTACK_DOCS_DIST ??
  path.resolve(import.meta.dir, "../../../docs/dist");
if (fs.existsSync(docsDistPath)) {
  rootLogger.info(`📚 Serving in-app user guide from: ${docsDistPath}`);
  const serveDocsFile = async (c: Context, filePath: string) => {
    const file = Bun.file(filePath);
    const content = await file.arrayBuffer();
    c.header("Content-Type", file.type);
    return c.body(content);
  };
  app.get("/checkstack/*", async (c, next) => {
    // Map `/checkstack/<rest>` -> `<docsDist>/<rest>`, resolving a directory or
    // trailing-slash/pretty URL to its `index.html` (Starlight emits
    // `<slug>/index.html`). Fall through on a miss so non-doc `/checkstack/...`
    // paths aren't swallowed.
    const rel = c.req.path.replace(/^\/checkstack\/?/, "");
    if (rel.includes("..")) return next();

    let filePath = path.join(docsDistPath, rel);
    const isDir =
      rel === "" ||
      rel.endsWith("/") ||
      (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory());
    if (isDir) {
      filePath = path.join(docsDistPath, rel, "index.html");
    } else if (!fs.existsSync(filePath)) {
      // Pretty URL with no trailing slash (e.g. /checkstack/user-guide).
      const asIndex = path.join(docsDistPath, rel, "index.html");
      if (fs.existsSync(asIndex)) filePath = asIndex;
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      return serveDocsFile(c, filePath);
    }
    // Unknown `/checkstack/*` path: this namespace IS the docs site (the
    // platform's own endpoints live under `/.checkstack/`, with a dot), so serve
    // Starlight's own 404 page with a real 404 status instead of falling through
    // to the SPA catch-all (which would 200 the app shell for a missing doc).
    const notFoundPage = path.join(docsDistPath, "404.html");
    if (fs.existsSync(notFoundPage)) {
      c.status(404);
      return serveDocsFile(c, notFoundPage);
    }
    return c.text("Not Found", 404);
  });
}

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

  /**
   * Serve a bundle's HTML entry with the frontend bootstrap blob inlined.
   *
   * Inlining `config` + `enabledPlugins` (the SAME values `/api/config` and
   * `/api/plugins` return) lets the SPA read them synchronously at boot instead
   * of fetching them serially before first paint. The session is intentionally
   * left out (it stays a better-auth fetch), so this HTML carries no per-user
   * data. It IS per-deployment (the plugin list changes when an operator
   * installs a plugin) and tiny, so it is served `no-cache`: the browser
   * revalidates each load and never shows a stale plugin list, while the hashed
   * `/assets/*` chunks stay immutably cacheable.
   */
  const serveBootstrappedHtml = async (
    c: Context,
    filePath: string,
    publicMatch: PublicHostMatch | null,
  ) => {
    const html = await Bun.file(filePath).text();
    const config = publicMatch
      ? { baseUrl: requestOrigin(c), publicHost: publicMatch.bootstrap }
      : {
          baseUrl: process.env.BASE_URL || "http://localhost:3000",
          publicPathPrefixes,
          ...(instanceNamespace ? { instanceNamespace } : {}),
        };
    // The public bundle loads no host plugins, so it never needs the list.
    const enabledPlugins = publicMatch
      ? []
      : await getEnabledRemoteFrontendPlugins();
    c.header("Cache-Control", "no-cache");
    return c.html(injectBootstrap({ html, bootstrap: { config, enabledPlugins } }));
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
    // Skip API and WebSocket routes - let them pass through to actual handlers.
    // The trailing slash matters: `/api-docs` is a frontend route and must hit
    // the SPA fallback below, while `/api/...` and `/rest/...` go to backend
    // handlers (oRPC RPC + OpenAPI REST mounts).
    const apiPath =
      c.req.path.startsWith("/api/") || c.req.path.startsWith("/rest/");
    // Runtime frontend-plugin assets are served by the `/assets/plugins/*`
    // route registered later during init. Defer to it here, otherwise this SPA
    // fallback would return index.html for a plugin's mf-manifest.json /
    // remoteEntry.js and the Module Federation runtime would fail (#RUNTIME-003).
    if (apiPath || c.req.path.startsWith("/assets/plugins/")) {
      return next();
    }

    // On a custom-domain public host we serve the SEPARATE public bundle and
    // NEVER the admin SPA shell (the host middleware already 404'd /api, /rest,
    // and docs). Resolve once here, for both the direct-file guard and the
    // fallback below.
    const publicMatch = await matchPublicHost(c);
    const indexFile = publicMatch ? "public.html" : "index.html";

    // Check if the request maps to an actual file in the dist root
    // (e.g., /favicon.svg -> dist/favicon.svg). Never serve a bundle HTML entry
    // by path here — that is the host-dependent fallback's job, so a public host
    // cannot fetch the admin `index.html` directly.
    const reqPath = c.req.path.slice(1); // Remove leading "/"
    const isBundleHtml = reqPath === "index.html" || reqPath === "public.html";
    if (reqPath && !isBundleHtml && !reqPath.includes("..")) {
      const staticFilePath = path.join(frontendDistPath, reqPath);
      // Only serve if it's a file (not a directory) and exists
      if (fs.existsSync(staticFilePath) && fs.statSync(staticFilePath).isFile()) {
        return serveFile(c, staticFilePath);
      }
    }

    // SPA fallback: serve the host-appropriate bundle for all remaining
    // non-API routes. On a public host whose public bundle is missing (e.g. an
    // older dist), fail safe with 404 rather than leaking the admin shell.
    const indexPath = path.join(frontendDistPath, indexFile);
    if (fs.existsSync(indexPath)) {
      return serveBootstrappedHtml(c, indexPath, publicMatch);
    }
    return c.notFound();
  });
}

const init = async () => {
  rootLogger.info("🚀 Starting Checkstack Core...");

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
  const configService = new ConfigServiceImpl(
    "backend",
    db,
    rootLogger.child({ plugin: "backend" }),
  );

  // 1.65. Register the instance runtime so plugins can namespace shared-infra
  // state (redis/BullMQ key prefixes, shared cache prefixes, consumer groups).
  // Registered BEFORE the queue/cache services so those can resolve it at init.
  pluginManager.registerService(
    coreServices.instanceRuntime,
    createInstanceRuntime({ namespace: instanceNamespace }),
  );
  if (instanceNamespace) {
    rootLogger.info(
      `🔀 Running as secondary instance "${instanceNamespace}"; shared infrastructure is namespaced.`,
    );
  }

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

  // Backlog gauge: now that the QueueManager exists, expose queue pending/
  // processing depth on the metrics endpoint (no-op unless metrics are enabled).
  registerQueueInstruments({ queueManager });

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

  // 1.9. Register Plugin Install Services (artifact store + installer registry)
  rootLogger.debug("Registering plugin install services...");
  const runtimePluginsDir = path.join(process.cwd(), "runtime_plugins");
  fs.mkdirSync(runtimePluginsDir, { recursive: true });
  const pluginArtifactStore = new PostgresPluginArtifactStore(db);
  const pluginInstallerRegistry = new DefaultPluginInstallerRegistry({
    runtimeDir: runtimePluginsDir,
    artifactStore: pluginArtifactStore,
  });
  pluginManager.registerService(
    coreServices.pluginArtifactStore,
    pluginArtifactStore,
  );
  pluginManager.registerService(
    coreServices.pluginInstallerRegistry,
    pluginInstallerRegistry,
  );
  // Per-instance event recorder (instanceId is the bun process pid for now;
  // upgrade to a stable instance id when multi-region deploys land).
  const eventRecorder = new PluginEventRecorder(db, `bun-${process.pid}`);
  pluginManager.setEventRecorder(eventRecorder);
  pluginManager.setRuntimeDir(runtimePluginsDir);

  // Tarball-upload endpoint backing the install UI's "Tarball Upload" tab.
  //
  // The user uploads a `.tgz` produced by `bunx @checkstack/scripts plugin-pack`
  // (single-package or `--bundle` mode). We peek the bytes to derive the
  // primary `(name, version)`, persist the artifact to plugin_artifacts, and
  // return the `artifactId`. The frontend then submits a `PluginSource` of
  // type "tarball" with that id to `previewInstall` / `install`.
  //
  // We deliberately keep this as a plain Hono route (not an oRPC procedure)
  // because oRPC contracts are JSON-only — multipart bodies can't be
  // expressed there. Auth + access are enforced manually below using the
  // same access service the rest of the platform uses.
  app.post("/api/pluginmanager/upload-tarball", async (c) => {
    const authService = await pluginManager.getService(coreServices.auth);
    if (!authService) {
      return c.json({ error: "Auth service not available" }, 503);
    }
    const user = await authService.authenticate(c.req.raw);
    if (!user || user.type === "service") {
      return c.json({ error: "Authentication required" }, 401);
    }
    const requiredAccess = `${pluginManagerMetadata.pluginId}.${pluginManagerAccess.install.id}`;
    const accessRules = (
      "accessRules" in user ? user.accessRules : []
    ) as string[];
    const anonymous = await authService.getAnonymousAccessRules();
    // `enrichUser` collapses the admin role to the `"*"` wildcard (it never
    // materialises every individual rule id), so an admin's `accessRules` is
    // just `["*"]`. Honour that wildcard the same way the autoAuthMiddleware
    // and oRPC procedures do (see auth-backend router.ts) - a bare
    // `includes(requiredAccess)` would 403 every admin on this hand-rolled
    // multipart route.
    const hasAccess =
      accessRules.includes("*") ||
      accessRules.includes(requiredAccess) ||
      anonymous.includes(requiredAccess);
    if (!hasAccess) {
      return c.json({ error: "Access denied" }, 403);
    }

    const formData = await c.req.formData();
    const file = formData.get("file");
    if (!file || typeof file === "string") {
      return c.json({ error: "Missing 'file' field in multipart body" }, 400);
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.byteLength === 0) {
      return c.json({ error: "Uploaded file is empty" }, 400);
    }
    if (bytes.byteLength > MAX_TARBALL_SIZE_BYTES) {
      return c.json(
        {
          error: `Tarball exceeds maximum size: ${bytes.byteLength} > ${MAX_TARBALL_SIZE_BYTES} bytes`,
        },
        413,
      );
    }

    // Derive (name, version) by peeking the tarball. For bundle tarballs,
    // use the primary's manifest entry; for single packages, the embedded
    // package.json. Validation happens here too — a malformed tarball is
    // rejected before any DB write.
    let pluginName: string;
    let version: string;
    try {
      const bundle = await tryExtractBundle(bytes);
      if (bundle) {
        pluginName = bundle.manifest.primary;
        const primaryEntry = bundle.manifest.packages.find(
          (p) => p.name === bundle.manifest.primary,
        );
        if (!primaryEntry) {
          return c.json(
            { error: `Bundle manifest missing primary entry '${pluginName}'` },
            400,
          );
        }
        version = primaryEntry.version;
      } else {
        const meta = await extractPackageJson(bytes);
        pluginName = meta.name;
        version = meta.version;
      }
    } catch (error) {
      return c.json(
        { error: `Failed to peek tarball: ${extractErrorMessage(error)}` },
        400,
      );
    }

    const { artifactId, contentHash } = await pluginArtifactStore.store({
      pluginName,
      version,
      tarball: bytes,
    });

    rootLogger.info(
      `📦 Tarball uploaded: ${pluginName}@${version} (artifactId=${artifactId}, ${bytes.byteLength} bytes)`,
    );

    return c.json({
      artifactId,
      pluginName,
      version,
      contentHash,
      sizeBytes: bytes.byteLength,
    });
  });

  // Serve static assets for runtime frontend plugins (built Module Federation
  // remotes). The plugin is served under its package name, which may be SCOPED
  // (e.g. /assets/plugins/@scope/name/mf-manifest.json) — so a single-segment
  // `:pluginName` route can't capture it. Use a catch-all and split the package
  // name (two segments when it starts with `@`) from the asset path.
  // e.g. /assets/plugins/@acme/widget-frontend/mf-manifest.json ->
  //      runtime_plugins/node_modules/@acme/widget-frontend/dist/mf-manifest.json
  const ASSET_CONTENT_TYPES: Record<string, string> = {
    ".js": "text/javascript",
    ".mjs": "text/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".map": "application/json",
    ".wasm": "application/wasm",
  };
  app.use("/assets/plugins/*", async (c, next) => {
    const rest = c.req.path.split("/assets/plugins/")[1] ?? "";
    const segments = rest.split("/").filter(Boolean);
    const scoped = rest.startsWith("@");
    const pluginName = scoped
      ? segments.slice(0, 2).join("/")
      : segments[0];
    const assetPath = scoped
      ? segments.slice(2).join("/")
      : segments.slice(1).join("/");
    // Reject path traversal and empty lookups.
    if (!pluginName || !assetPath || assetPath.includes("..")) {
      return next();
    }

    const results = await db
      .select()
      .from(plugins)
      .where(eq(plugins.name, pluginName));
    const plugin = results[0];
    if (!plugin || plugin.type !== "frontend") {
      return next();
    }

    const filePath = path.join(plugin.path, "dist", assetPath);
    if (fs.existsSync(filePath)) {
      const type =
        ASSET_CONTENT_TYPES[path.extname(filePath)] ??
        "application/octet-stream";
      c.header("Content-Type", type);
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
  //
  // Dev-server mode (entered via `bunx @checkstack/scripts dev` from a
  // plugin author's repo). Two env vars control it:
  //
  //   - CHECKSTACK_DEV_PLUGIN_PATH: absolute path to a plugin module's
  //     directory whose `default` export is the BackendPlugin to load.
  //     When set, filesystem discovery is skipped — only this plugin and
  //     core services are loaded. Lets a plugin author iterate without
  //     a workspace checkout.
  //   - CHECKSTACK_DEV_AUTH=true: registers a synthetic auth service that
  //     auto-grants every access rule. Skips login flow entirely. Strictly
  //     refused on a known-prod NODE_ENV value to make accidental misuse
  //     loud.
  const devPluginPath = process.env.CHECKSTACK_DEV_PLUGIN_PATH;
  const devAuth = process.env.CHECKSTACK_DEV_AUTH === "true";
  if (devAuth) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "CHECKSTACK_DEV_AUTH=true is refused when NODE_ENV=production. " +
          "Dev auth bypasses every access guard and must never run in prod.",
      );
    }
    rootLogger.warn(
      "🛠 Dev auth ENABLED — every access rule is auto-granted. Do NOT use in production.",
    );
    // Register the dev auth service as a FACTORY, not a plain instance.
    // `registerCoreServices` already registered the real (token/strategy-
    // based) auth as a factory for `coreServices.auth`, and
    // `ServiceRegistry.get()` resolves factories BEFORE instances — so a
    // plain `registerService(coreServices.auth, devAuthService)` would be
    // shadowed by the production factory and the dev bypass would never take
    // effect (every plugin API request would 401 with "Authentication
    // required"). Registering the dev auth as a factory makes `get()` reach
    // it. This stays entirely inside the dev-flag-gated path: the production
    // auth factory is left in place and untouched whenever CHECKSTACK_DEV_AUTH
    // is not set.
    // Scoped per plugin (like the production auth factory) so each plugin's
    // S2S credentials are minted as `{ service: <its pluginId> }`.
    pluginManager
      .getRegistry()
      .registerFactory(coreServices.auth, (metadata) =>
        createDevAuthService({
          getAllAccessRules: () => pluginManager.getAllAccessRules(),
          pluginId: metadata.pluginId,
        }),
      );
  }

  const manualPlugins: BackendPlugin[] = [];
  // Maps a manually-loaded plugin's id to its on-disk dir so the loader can
  // run its Drizzle migrations (in `<dir>/drizzle`). Without this, manual
  // plugins get `pluginPath: ""` and their migrations are skipped — which is
  // why a freshly-scaffolded plugin booted with no `items` table.
  const manualPluginPaths = new Map<string, string>();
  if (devPluginPath) {
    rootLogger.info(`🛠 Dev mode — loading plugin from ${devPluginPath}`);

    // Co-load `@checkstack/*` backend deps the dev command resolved from
    // the plugin's package.json. Without these, the plugin under dev's
    // `init()` would hit unregistered services. The dev command always
    // includes in-memory queue+cache providers when no other provider
    // is in the dep graph, so coreServices.queueManager /
    // coreServices.cacheManager have a registered strategy on boot.
    const extraPathsRaw = process.env.CHECKSTACK_DEV_EXTRA_PLUGIN_PATHS;
    const extraPaths: string[] = extraPathsRaw ? JSON.parse(extraPathsRaw) : [];
    for (const extra of extraPaths) {
      try {
        const mod = await import(extra);
        const exp = mod.default as BackendPlugin | undefined;
        if (!exp || typeof exp.register !== "function") {
          throw new Error(
            `Module at ${extra} does not export a default BackendPlugin`,
          );
        }
        manualPlugins.push(exp);
      } catch (error) {
        throw new Error(
          `Failed to import co-loaded core plugin from ${extra}: ${extractErrorMessage(error)}`,
        );
      }
    }

    // Plugin under dev loads last; the platform's pendingInits topo-sort
    // takes care of actual init order, but importing it last makes the
    // boot log easier to read.
    try {
      const pluginModule = await import(devPluginPath);
      const pluginExport = pluginModule.default as BackendPlugin | undefined;
      if (!pluginExport || typeof pluginExport.register !== "function") {
        throw new Error(
          `Module at ${devPluginPath} does not export a default BackendPlugin`,
        );
      }
      manualPlugins.push(pluginExport);
      // `CHECKSTACK_DEV_PLUGIN_PATH` is the plugin's repo dir (the dev server
      // sets it to the plugin cwd), so its migrations live at `<dir>/drizzle`.
      manualPluginPaths.set(pluginExport.metadata.pluginId, devPluginPath);
    } catch (error) {
      throw new Error(
        `Failed to import dev plugin from ${devPluginPath}: ${extractErrorMessage(error)}`,
      );
    }
  }

  // Register the plugin-manager's core access rules + metadata BEFORE
  // loadPlugins. The auth-backend's full access-rule sync to the DB runs in
  // `afterPluginsReady`, which fires *inside* loadPlugins and reads
  // `pluginManager.getAllAccessRules()` at that moment. Registering these
  // core rules after loadPlugins (where the router is wired up below) would
  // miss that sync entirely, so the admin role would never be granted
  // `pluginmanager.plugin.manage` and the install endpoints would 403 even
  // for operators. The ids land prefixed as e.g. `pluginmanager.plugin.manage`.
  pluginManager.registerCoreAccessRules(
    pluginManagerMetadata.pluginId,
    pluginManagerAccessRules,
  );
  pluginManager.registerCorePluginMetadata(pluginManagerMetadata);

  await pluginManager.loadPlugins(app, manualPlugins, {
    skipDiscovery: !!devPluginPath,
    manualPluginPaths,
  });

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

  // 4.5. Register the plugin-manager admin router (core router, not a regular
  // plugin). Its access rules + metadata were registered before loadPlugins
  // above so the auth-backend full sync picks them up; here we only wire the
  // router now that plugin services are available.
  const pluginManagerRouter = createPluginManagerRouter({
    db,
    pluginManager,
    registry: pluginManager.getRegistry(),
    eventRecorder,
    workspaceRoot: path.resolve(import.meta.dir, "..", "..", ".."),
    runtimeDir: runtimePluginsDir,
  });
  pluginManager.registerCoreRouter(
    pluginManagerMetadata.pluginId,
    pluginManagerRouter,
  );

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

  // SECURITY: WebSocket upgrades are handled here, BEFORE the Hono app — so the
  // host-routing middleware (which enforces the public-host allow-list) never
  // sees them. Gate them explicitly: a matched custom-domain public host exposes
  // ONLY its allow-listed HTTP endpoints (status pages declare no WS), so refuse
  // any WS upgrade there. Unknown / primary hosts are unaffected.
  const wsHost = normalizeHost(req.headers.get("host"));
  if (
    wsHost &&
    wsHost !== primaryHost &&
    (url.pathname === "/api/signals/ws" || url.pathname.startsWith("/api/ws/"))
  ) {
    const match = await publicHostRegistry.resolve(wsHost);
    if (match && !match.allowedApiPaths.includes(url.pathname)) {
      return new Response("Not Found", { status: 404 });
    }
  }

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

// Bun closes a connection that stays idle (no bytes sent or received) for
// `idleTimeout` seconds. The default is 10s, which severs long agentic chat
// turns: the AI assistant streams an SSE response that can pause >10s between
// chunks while a slow provider "thinks" or a tool runs, surfacing as
// "Error in input stream" on the client. Raise it to Bun's maximum (255s) so a
// multi-step turn is not killed; each streamed chunk resets the idle timer, so
// only a single >255s silent gap would still time out.
const IDLE_TIMEOUT_SECONDS = (() => {
  const raw = Number(process.env.CHECKSTACK_SERVER_IDLE_TIMEOUT_SECONDS);
  // Bun clamps idleTimeout to [0, 255]; keep within range and fall back to max.
  return Number.isFinite(raw) && raw >= 0 && raw <= 255 ? raw : 255;
})();

export default {
  // Listen port. Defaults to 3000; overridable via PORT so a second instance
  // (e.g. an isolated E2E stack) can run alongside a dev server on another port.
  port: Number(process.env.PORT) || 3000,
  idleTimeout: IDLE_TIMEOUT_SECONDS,
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
