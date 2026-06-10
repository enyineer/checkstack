import { afterAll, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { z } from "zod";
import { implement, ORPCError } from "@orpc/server";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ContractRouterClient } from "@orpc/contract";
import { proc } from "@checkstack/common";
import {
  coreServices,
  createMockRpcContext,
  autoAuthMiddleware,
  correlationMiddleware,
  type AuthService,
  type AuthUser,
  type EventBus,
  type RpcContext,
} from "@checkstack/backend-api";
import { ServiceRegistry } from "../services/service-registry";
import { createApiRouteHandler, registerApiRoute } from "./api-router";

/**
 * REAL end-to-end auth-passthrough test for the `/api/:pluginId/*` dispatcher.
 *
 * This guards the regression where `createApiRouteHandler` built the per-request
 * `RpcContext` WITHOUT `requestHeaders`, so a handler that re-enters the router
 * as the originating user (an AI tool's user-scoped rpcClient via
 * `proposeTool`/`applyTool`) forwarded NO auth and the loopback failed with
 * "Authentication required". It exercises the actual wiring over real HTTP - a
 * real `Bun.serve`, the real dispatcher, real `autoAuthMiddleware`, and a real
 * loopback oRPC client - with NO fakes for the path under test. The only stubs
 * are unrelated core-service collaborators (db, registries, queue, cache), which
 * none of these handlers touch.
 *
 * `caller.run` mirrors exactly what `proposeTool`/`applyTool` do: read
 * `context.requestHeaders`, forward the caller's own cookie/bearer, and call a
 * gated procedure on another plugin AS THAT USER. With the bug present,
 * `caller.run` would throw "Authentication required" instead of returning the
 * caller's id - so this test goes red without the fix and green with it.
 */

// ─── Contracts (a "target" plugin gated by auth, a "caller" that loops back) ──

const targetContract = {
  // Requires an authenticated user; echoes WHO the router authenticated.
  whoami: proc({
    operationType: "query",
    userType: "authenticated",
    access: [],
  }).output(z.object({ id: z.string(), kind: z.string() })),
};

const callerContract = {
  // PUBLIC so it is reachable without outer auth - that lets us prove the
  // LOOPBACK itself enforces auth (an unauthenticated run still fails downstream).
  run: proc({ operationType: "query", userType: "public", access: [] }).output(
    z.object({ id: z.string(), kind: z.string() }),
  ),
  // Directly surfaces whether the dispatcher populated `context.requestHeaders`.
  echo: proc({ operationType: "query", userType: "public", access: [] }).output(
    z.object({ seenAuthHeader: z.string().nullable() }),
  ),
};

const rootContract = { target: targetContract, caller: callerContract };
type RootClient = ContractRouterClient<typeof rootContract>;

// Set once the server is listening; the caller handler reads it at call time.
const server = { baseUrl: "" };

// ─── Routers ──────────────────────────────────────────────────────────────

function buildTargetRouter() {
  const os = implement(targetContract)
    .$context<RpcContext>()
    .use(correlationMiddleware)
    .use(autoAuthMiddleware);
  return os.router({
    whoami: os.whoami.handler(async ({ context }) => {
      // autoAuthMiddleware already rejected an unauthenticated caller; this guard
      // also narrows the AuthUser union to the `user` variant (which carries id).
      const user = context.user;
      if (!user || user.type !== "user") {
        throw new ORPCError("UNAUTHORIZED", {
          message: "Authentication required",
        });
      }
      return { id: user.id, kind: user.type };
    }),
  });
}

function buildCallerRouter() {
  const os = implement(callerContract)
    .$context<RpcContext>()
    .use(correlationMiddleware)
    .use(autoAuthMiddleware);
  return os.router({
    run: os.run.handler(async ({ context }) => {
      // EXACTLY the proposeTool/applyTool pattern: forward the caller's own auth
      // headers and re-enter the router as that user.
      const forward: Record<string, string> = {};
      const auth = context.requestHeaders?.get("authorization");
      if (auth) forward.authorization = auth;
      const cookie = context.requestHeaders?.get("cookie");
      if (cookie) forward.cookie = cookie;
      const link = new RPCLink({
        url: `${server.baseUrl}/api`,
        headers: forward,
      });
      const client = createORPCClient<RootClient>(link);
      return client.target.whoami();
    }),
    echo: os.echo.handler(async ({ context }) => ({
      seenAuthHeader: context.requestHeaders?.get("authorization") ?? null,
    })),
  });
}

// ─── Real auth: maps `Authorization: Bearer u-<id>` to a user principal ──────

// A typed no-op event bus: these handlers never emit, so the bus only needs to
// exist (the dispatcher requires it non-null). No fakes are needed for the path
// under test.
const noopEventBus: EventBus = {
  subscribe: async () => async () => {},
  emit: async () => {},
  emitLocal: async () => {},
  shutdown: async () => {},
};

const realAuth: AuthService = {
  async authenticate(request) {
    const header = request.headers.get("authorization");
    const match = header?.match(/^Bearer u-(.+)$/);
    if (!match) return undefined;
    return {
      type: "user",
      id: match[1],
      accessRules: ["*"],
    } satisfies AuthUser;
  },
  async getCredentials() {
    return { headers: {} };
  },
  async getAnonymousAccessRules() {
    return [];
  },
  async check() {
    return { hasAccess: false };
  },
  async listAccessibleObjectIds({ objectIds }) {
    return objectIds;
  },
  async hasAnyTypeGrant() {
    return { hasGrant: true };
  },
  async authorizeCreate() {
    return { ownerTeamId: null, isPrivate: false };
  },
  async setOwner() {},
};

// ─── Harness: real dispatcher on a real Bun.serve ────────────────────────────

function buildRegistry(): ServiceRegistry {
  // Reuse the canonical stub shapes for the collaborators none of these handlers
  // touch; override auth with the real header-reading strategy and event bus.
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
  registry.register(coreServices.auth, realAuth);
  return registry;
}

const app = new Hono();
const apiHandler = createApiRouteHandler({
  registry: buildRegistry(),
  pluginRpcRouters: new Map<string, unknown>([
    ["target", buildTargetRouter()],
    ["caller", buildCallerRouter()],
  ]),
  pluginHttpHandlers: new Map(),
  pluginMetadataRegistry: new Map([
    ["target", { pluginId: "target" }],
    ["caller", { pluginId: "caller" }],
  ]),
});
registerApiRoute(app, apiHandler);

const listening = Bun.serve({ port: 0, fetch: app.fetch });
server.baseUrl = `http://localhost:${listening.port}`;

afterAll(() => {
  listening.stop(true);
});

function clientWith(headers: Record<string, string>): RootClient {
  return createORPCClient<RootClient>(
    new RPCLink({ url: `${server.baseUrl}/api`, headers }),
  );
}

describe("RPC dispatcher auth passthrough (real HTTP)", () => {
  test("the dispatcher populates context.requestHeaders from the request", async () => {
    const client = clientWith({ authorization: "Bearer u-alice" });
    const echo = await client.caller.echo();
    // The exact regression: without requestHeaders on the context this is null.
    expect(echo.seenAuthHeader).toBe("Bearer u-alice");
  });

  test("a request for an UNKNOWN plugin id returns 404, not 500", async () => {
    // No metadata is registered for 'nope', so the dispatcher must treat it as a
    // not-found resource (client error), not an internal server error.
    const res = await fetch(`${server.baseUrl}/api/nope/whatever`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(404);
  });

  test("a loopback call re-enters the router authenticated AS the originating user", async () => {
    const client = clientWith({ authorization: "Bearer u-alice" });
    const result = await client.caller.run();
    // caller.run forwarded alice's bearer to target.whoami, which authenticated
    // as alice. With the bug (requestHeaders undefined) this throws
    // "Authentication required" instead.
    expect(result).toEqual({ id: "alice", kind: "user" });
  });

  test("a different user's auth is forwarded as THAT user (no cross-user bleed)", async () => {
    const result = await clientWith({ authorization: "Bearer u-bob" }).caller.run();
    expect(result).toEqual({ id: "bob", kind: "user" });
  });

  test("an unauthenticated loopback is refused downstream (auth still enforced)", async () => {
    // caller.run is public, so the OUTER call proceeds; the loopback forwards no
    // auth, so target.whoami refuses - proving the loopback does NOT bypass authz.
    await expect(clientWith({}).caller.run()).rejects.toThrow(
      /Authentication required|UNAUTHORIZED/i,
    );
  });

  test("calling the gated procedure directly with auth works (sanity)", async () => {
    const result = await clientWith({
      authorization: "Bearer u-carol",
    }).target.whoami();
    expect(result).toEqual({ id: "carol", kind: "user" });
  });

  test("calling the gated procedure directly WITHOUT auth is refused", async () => {
    await expect(clientWith({}).target.whoami()).rejects.toThrow(
      /Authentication required|UNAUTHORIZED/i,
    );
  });
});
