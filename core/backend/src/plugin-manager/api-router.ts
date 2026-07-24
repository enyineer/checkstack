import type { Hono, Context } from "hono";
import type { SafeDatabase } from "@checkstack/backend-api";
import { RPCHandler } from "@orpc/server/fetch";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { SmartCoercionPlugin } from "@orpc/json-schema";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import {
  coreServices,
  AuthService,
  RpcContext,
  Logger,
  Fetch,
  HealthCheckRegistry,
  CollectorRegistry,
  resolveActor,
  type EmitHookFn,
  type Hook,
} from "@checkstack/backend-api";
import type { QueuePluginRegistry, QueueManager } from "@checkstack/queue-api";
import type {
  CachePluginRegistry,
  CacheManager,
} from "@checkstack/cache-api";
import type { ServiceRegistry } from "../services/service-registry";
import type { EventBus } from "@checkstack/backend-api";
import type { PluginMetadata } from "@checkstack/common";
import { rootLogger } from "../logger";
import { extractErrorMessage } from "@checkstack/common";
import { mapPgErrorToHttp, isClientRejection } from "./pg-http-errors";

interface RouteHandlerDeps {
  registry: ServiceRegistry;
  pluginRpcRouters: Map<string, unknown>;
  pluginMetadataRegistry: Map<string, PluginMetadata>;
}

interface ResolvedRequestContext {
  context: RpcContext;
  logger: Logger;
}

type ContextResult =
  | { ok: true; resolved: ResolvedRequestContext }
  | { ok: false; response: Response };

function createServiceGetter(registry: ServiceRegistry) {
  return async function getService<T>(ref: {
    id: string;
    T: T;
  }): Promise<T | undefined> {
    try {
      return await registry.get(ref, { pluginId: "core" });
    } catch {
      return undefined;
    }
  };
}

/**
 * Resolve auth + core services and build the per-request RpcContext.
 * Shared between the oRPC `/api/*` handler and the REST `/rest/*` handler.
 */
async function resolveRequestContext({
  c,
  pluginId,
  deps,
}: {
  c: Context;
  pluginId: string;
  deps: RouteHandlerDeps;
}): Promise<ContextResult> {
  const getService = createServiceGetter(deps.registry);
  const pathname = new URL(c.req.raw.url).pathname;

  const logger = await getService(coreServices.logger);
  const auth = await getService(coreServices.auth);
  const db = await getService(coreServices.database);
  const fetch = await getService(coreServices.fetch);
  const healthCheckRegistry = await getService(
    coreServices.healthCheckRegistry,
  );
  const collectorRegistry = await getService(coreServices.collectorRegistry);
  const queuePluginRegistry = await getService(
    coreServices.queuePluginRegistry,
  );
  const queueManager = await getService(coreServices.queueManager);
  const cachePluginRegistry = await getService(
    coreServices.cachePluginRegistry,
  );
  const cacheManager = await getService(coreServices.cacheManager);
  const eventBus = await getService(coreServices.eventBus);

  if (
    !auth ||
    !logger ||
    !db ||
    !fetch ||
    !healthCheckRegistry ||
    !collectorRegistry ||
    !queuePluginRegistry ||
    !queueManager ||
    !cachePluginRegistry ||
    !cacheManager ||
    !eventBus
  ) {
    const missing = [
      !auth && "auth",
      !logger && "logger",
      !db && "db",
      !fetch && "fetch",
      !healthCheckRegistry && "healthCheckRegistry",
      !collectorRegistry && "collectorRegistry",
      !queuePluginRegistry && "queuePluginRegistry",
      !queueManager && "queueManager",
      !cachePluginRegistry && "cachePluginRegistry",
      !cacheManager && "cacheManager",
      !eventBus && "eventBus",
    ]
      .filter(Boolean)
      .join(", ");
    (logger ?? rootLogger).error(
      `${pathname}: core services not initialized — missing: ${missing}`,
    );
    return {
      ok: false,
      response: c.json({ error: "Core services not initialized" }, 500),
    };
  }

  const user = await (auth as AuthService).authenticate(c.req.raw);

  const emitHook: EmitHookFn = async <T>(hook: Hook<T>, payload: T) => {
    // Capture the authenticated caller as the event actor so automations can
    // filter on who/what caused the event (falls back to the system actor for
    // unauthenticated callers).
    await (eventBus as EventBus).emit(hook, payload, {
      actor: resolveActor(user),
    });
  };

  const pluginMetadata: PluginMetadata | undefined =
    deps.pluginMetadataRegistry.get(pluginId);

  if (!pluginMetadata) {
    // No metadata for this pluginId. The common cause is a client requesting an
    // unknown plugin (typo / probing) - a 404, not a 500. A genuine
    // misconfiguration (a core router that forgot
    // pluginManager.registerCorePluginMetadata()) surfaces the same way, so we
    // log it for diagnosis, but at warn level since the dominant case is a
    // client error and erroring on every bad path would be noise.
    (logger as Logger).warn(
      `${pathname}: no plugin metadata registered for pluginId='${pluginId}'. ` +
        `Either the plugin id is unknown (client typo / probe), or a core ` +
        `router did not call pluginManager.registerCorePluginMetadata().`,
    );
    return {
      ok: false,
      response: c.json({ error: "Not Found" }, 404),
    };
  }

  const context: RpcContext = {
    pluginMetadata,
    auth: auth as AuthService,
    logger: logger as Logger,
    db: db as SafeDatabase<Record<string, unknown>>,
    fetch: fetch as Fetch,
    healthCheckRegistry: healthCheckRegistry as HealthCheckRegistry,
    collectorRegistry: collectorRegistry as CollectorRegistry,
    queuePluginRegistry: queuePluginRegistry as QueuePluginRegistry,
    queueManager: queueManager as QueueManager,
    cachePluginRegistry: cachePluginRegistry as CachePluginRegistry,
    cacheManager: cacheManager as CacheManager,
    user,
    // The incoming request's headers, so a handler can forward the caller's OWN
    // auth (session cookie / bearer) when it re-enters the router as the same
    // user - e.g. an AI tool's user-scoped rpcClient (proposeTool/applyTool).
    // Also read by correlationMiddleware for the inbound correlation id.
    requestHeaders: c.req.raw.headers,
    emitHook,
  };

  return { ok: true, resolved: { context, logger: logger as Logger } };
}

function buildRpcRouter(
  pluginRpcRouters: Map<string, unknown>,
): Record<string, unknown> {
  const rootRpcRouter: Record<string, unknown> = {};
  for (const [pluginId, router] of pluginRpcRouters.entries()) {
    rootRpcRouter[pluginId] = router;
  }
  return rootRpcRouter;
}

function logHandlerError({
  error,
  pathname,
  logger,
  protocolLabel,
}: {
  error: unknown;
  pathname: string;
  logger: Logger | undefined;
  protocolLabel: string;
}) {
  const target = (logger ?? rootLogger) as Logger;
  target.error(
    `${protocolLabel} ${pathname} failed: ${extractErrorMessage(error)}`,
  );
  const stack =
    error !== null && typeof error === "object" && "stack" in error
      ? (error as { stack: string }).stack
      : undefined;
  if (stack) {
    target.error(`Stack trace: ${stack}`);
  }
}

/**
 * Shared interceptor catch path for both the RPC and REST handlers. A Postgres
 * driver error caused by bad client input (bad uuid, out-of-range int, over-long
 * string, constraint violation) is mapped to the correct 4xx `ORPCError` and
 * logged at warn (it is a client mistake, not a server fault). A 4xx the
 * contract itself raised (401/403/404/409/...) is the authorization or
 * validation layer working as designed, so it is logged at DEBUG without a
 * stack: the access-log middleware already reports every 4xx response at warn
 * with its method, path and status, and duplicating that as an error-level
 * stack made routine anonymous traffic look like the server was breaking.
 * Everything else keeps the existing error-level logging + rethrow so genuine
 * 500s stay loud.
 */
function rethrowAsHttpError({
  error,
  pathname,
  logger,
  protocolLabel,
}: {
  error: unknown;
  pathname: string;
  logger: Logger | undefined;
  protocolLabel: string;
}): never {
  const mapped = mapPgErrorToHttp(error);
  if (mapped) {
    (logger ?? rootLogger).warn(
      `${protocolLabel} ${pathname}: ${mapped.code} (${extractErrorMessage(error)})`,
    );
    throw mapped;
  }
  if (isClientRejection(error)) {
    (logger ?? rootLogger).debug(
      `${protocolLabel} ${pathname}: ${error.status} ${error.code} (${extractErrorMessage(error)})`,
    );
    throw error;
  }
  logHandlerError({ error, pathname, logger, protocolLabel });
  throw error;
}

/**
 * Creates the API route handler for Hono.
 * Serves oRPC's native RPC wire protocol at /api/:pluginId/*.
 */
export function createApiRouteHandler({
  registry,
  pluginRpcRouters,
  pluginHttpHandlers,
  pluginMetadataRegistry,
}: {
  registry: ServiceRegistry;
  pluginRpcRouters: Map<string, unknown>;
  pluginHttpHandlers: Map<string, (req: Request) => Promise<Response>>;
  pluginMetadataRegistry: Map<string, PluginMetadata>;
}) {
  const deps: RouteHandlerDeps = {
    registry,
    pluginRpcRouters,
    pluginMetadataRegistry,
  };

  return async function handleApiRequest(c: Context) {
    const pluginId = c.req.param("pluginId") || "";
    const pathname = new URL(c.req.raw.url).pathname;

    const result = await resolveRequestContext({ c, pluginId, deps });
    if (!result.ok) return result.response;
    const { context, logger } = result.resolved;

    const rpcHandler = new RPCHandler(
      buildRpcRouter(pluginRpcRouters) as ConstructorParameters<
        typeof RPCHandler
      >[0],
      {
        interceptors: [
          async ({ next, ...rest }) => {
            try {
              return await next(rest);
            } catch (error) {
              rethrowAsHttpError({
                error,
                pathname,
                logger,
                protocolLabel: "RPC",
              });
            }
          },
        ],
      },
    );

    const { matched, response } = await rpcHandler.handle(c.req.raw, {
      prefix: "/api",
      context,
    });

    if (matched) {
      return c.newResponse(response.body, response);
    }

    logger.debug(`RPC mismatch for: ${c.req.method} ${pathname}`);

    // Fall through to native plugin HTTP handlers (sorted longest-prefix first)
    const sortedHandlers = [...pluginHttpHandlers.entries()].toSorted(
      function (a, b) {
        return b[0].length - a[0].length;
      },
    );

    for (const [path, handler] of sortedHandlers) {
      if (pathname.startsWith(path)) {
        return handler(c.req.raw);
      }
    }

    return c.json({ error: "Not Found" }, 404);
  };
}

/**
 * Creates the REST route handler for Hono.
 * Serves the REST/OpenAPI shape of the same oRPC contract at /rest/:pluginId/*.
 * Standard JSON bodies / query params work here — matches /api/openapi.json.
 */
export function createRestRouteHandler({
  registry,
  pluginRpcRouters,
  pluginMetadataRegistry,
}: {
  registry: ServiceRegistry;
  pluginRpcRouters: Map<string, unknown>;
  pluginMetadataRegistry: Map<string, PluginMetadata>;
}) {
  const deps: RouteHandlerDeps = {
    registry,
    pluginRpcRouters,
    pluginMetadataRegistry,
  };

  return async function handleRestRequest(c: Context) {
    const pluginId = c.req.param("pluginId") || "";
    const pathname = new URL(c.req.raw.url).pathname;

    const result = await resolveRequestContext({ c, pluginId, deps });
    if (!result.ok) return result.response;
    const { context, logger } = result.resolved;

    const restHandler = new OpenAPIHandler(
      buildRpcRouter(pluginRpcRouters) as ConstructorParameters<
        typeof OpenAPIHandler
      >[0],
      {
        // REST query/path/header values are ALWAYS strings on the wire, but
        // contract input schemas declare real types (e.g. `includeResolved:
        // z.boolean()`, numbers, dates). Without coercion, oRPC validation
        // rejects `?includeResolved=true` with "expected boolean, received
        // string". SmartCoercionPlugin reads each procedure's JSON schema and
        // coerces the string into the declared type BEFORE validation -
        // crucially mapping the string "false" to `false` (unlike
        // `z.coerce.boolean()`, where `Boolean("false") === true`). The native
        // RPC handler at /api/* needs no coercion: its wire codec already
        // preserves booleans/numbers, so this plugin is REST-only.
        plugins: [
          new SmartCoercionPlugin({
            schemaConverters: [new ZodToJsonSchemaConverter()],
          }),
        ],
        interceptors: [
          async ({ next, ...rest }) => {
            try {
              return await next(rest);
            } catch (error) {
              rethrowAsHttpError({
                error,
                pathname,
                logger,
                protocolLabel: "REST",
              });
            }
          },
        ],
      },
    );

    const { matched, response } = await restHandler.handle(c.req.raw, {
      prefix: "/rest",
      context,
    });

    if (matched) {
      return c.newResponse(response.body, response);
    }

    logger.debug(`REST mismatch for: ${c.req.method} ${pathname}`);
    return c.json({ error: "Not Found" }, 404);
  };
}

/**
 * Registers the /api/:pluginId/* route with Hono.
 */
export function registerApiRoute(
  rootRouter: Hono,
  handler: ReturnType<typeof createApiRouteHandler>,
) {
  rootRouter.all("/api/:pluginId/*", handler);
}

/**
 * Registers the /rest/:pluginId/* route with Hono.
 */
export function registerRestRoute(
  rootRouter: Hono,
  handler: ReturnType<typeof createRestRouteHandler>,
) {
  rootRouter.all("/rest/:pluginId/*", handler);
}
