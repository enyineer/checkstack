import { afterAll, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { z } from "zod";
import { implement } from "@orpc/server";
import { proc } from "@checkstack/common";
import {
  coreServices,
  createMockRpcContext,
  autoAuthMiddleware,
  correlationMiddleware,
  type AuthService,
  type EventBus,
  type RpcContext,
} from "@checkstack/backend-api";
import { ServiceRegistry } from "../services/service-registry";
import { createRestRouteHandler, registerRestRoute } from "./api-router";

/**
 * Regression guard for REST query-param coercion.
 *
 * REST/OpenAPI query values arrive as strings on the wire, but contract input
 * schemas declare real types (e.g. `includeResolved: z.boolean()`). The REST
 * handler wires oRPC's `SmartCoercionPlugin` so `?includeResolved=true` is
 * coerced to the boolean `true` BEFORE Zod validation - and, crucially,
 * `?includeResolved=false` to `false` (not the `Boolean("false") === true`
 * trap). Without the plugin oRPC rejects the request with
 * "expected boolean, received string"; this test goes red if it is removed.
 *
 * Exercises the REAL `createRestRouteHandler` over real HTTP, not a hand-rolled
 * OpenAPIHandler, so the assertion is on the shipped configuration.
 */

const echoContract = {
  // Public + no access rules: anonymous requests pass the middleware, keeping
  // the test focused on coercion rather than authz.
  echo: proc({
    operationType: "query",
    userType: "public",
    access: [],
  })
    .input(
      z.object({
        includeResolved: z.boolean().optional().default(false),
        count: z.number().int().optional(),
      }),
    )
    .output(
      z.object({
        includeResolved: z.boolean(),
        count: z.number().optional(),
      }),
    ),
};

function buildEchoRouter() {
  const os = implement(echoContract)
    .$context<RpcContext>()
    .use(correlationMiddleware)
    .use(autoAuthMiddleware);
  return os.router({
    echo: os.echo.handler(async ({ input }) => ({
      includeResolved: input.includeResolved,
      count: input.count,
    })),
  });
}

const noopEventBus: EventBus = {
  subscribe: async () => async () => {},
  emit: async () => {},
  emitLocal: async () => {},
  shutdown: async () => {},
};

const anonymousAuth: AuthService = {
  async authenticate() {
    return undefined;
  },
  async getCredentials() {
    return { headers: {} };
  },
  async getAnonymousAccessRules() {
    return [];
  },
  async checkResourceTeamAccess() {
    return { hasAccess: false };
  },
  async getAccessibleResourceIds({ resourceIds }) {
    return resourceIds;
  },
};

function buildRegistry(): ServiceRegistry {
  const stub = createMockRpcContext();
  const registry = new ServiceRegistry();
  registry.register(coreServices.logger, stub.logger);
  registry.register(coreServices.database, stub.db);
  registry.register(coreServices.fetch, stub.fetch);
  registry.register(coreServices.healthCheckRegistry, stub.healthCheckRegistry);
  registry.register(coreServices.collectorRegistry, stub.collectorRegistry);
  registry.register(coreServices.queuePluginRegistry, stub.queuePluginRegistry);
  registry.register(coreServices.queueManager, stub.queueManager);
  registry.register(coreServices.cachePluginRegistry, stub.cachePluginRegistry);
  registry.register(coreServices.cacheManager, stub.cacheManager);
  registry.register(coreServices.eventBus, noopEventBus);
  registry.register(coreServices.auth, anonymousAuth);
  return registry;
}

const app = new Hono();
const restHandler = createRestRouteHandler({
  registry: buildRegistry(),
  pluginRpcRouters: new Map<string, unknown>([["coerce", buildEchoRouter()]]),
  pluginMetadataRegistry: new Map([["coerce", { pluginId: "coerce" }]]),
});
registerRestRoute(app, restHandler);

const listening = Bun.serve({ port: 0, fetch: app.fetch });
const baseUrl = `http://localhost:${listening.port}`;

afterAll(() => {
  listening.stop(true);
});

async function getEcho(qs: string) {
  const res = await fetch(`${baseUrl}/rest/coerce/echo${qs}`);
  return { status: res.status, body: await res.json() };
}

describe("REST query-param coercion (real HTTP)", () => {
  test("coerces the string 'true' to boolean true (and a numeric string to a number)", async () => {
    const { status, body } = await getEcho("?includeResolved=true&count=3");
    expect(status).toBe(200);
    expect(body).toEqual({ includeResolved: true, count: 3 });
  });

  test("coerces the string 'false' to boolean false - NOT the Boolean('false') trap", async () => {
    const { status, body } = await getEcho("?includeResolved=false");
    expect(status).toBe(200);
    expect(body.includeResolved).toBe(false);
  });

  test("applies the schema default when the param is absent", async () => {
    const { status, body } = await getEcho("");
    expect(status).toBe(200);
    expect(body.includeResolved).toBe(false);
  });
});
