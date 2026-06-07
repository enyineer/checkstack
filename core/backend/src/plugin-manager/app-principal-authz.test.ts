import { afterAll, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { z } from "zod";
import { implement } from "@orpc/server";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ContractRouterClient } from "@orpc/contract";
import { access, proc } from "@checkstack/common";
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
 * Hardening test for the automation `runAs` SERVICE-ACCOUNT principal.
 *
 * The whole design rests on ONE invariant: an automation's app-principal token
 * resolves to an `application` principal that is subject to the FULL access-rule
 * enforcement - it must NEVER be treated as a trusted `service` (which
 * short-circuits all checks = god mode). If a future change made the
 * app-principal a `service`, a prompt-injected AI Action could mutate any
 * team's data. This test pins the contrast over real HTTP (real dispatcher,
 * real `autoAuthMiddleware`, real loopback), so that regression goes red.
 *
 * It does not exercise the JWT mint/verify plumbing (that is mechanical); it
 * guards the security-relevant outcome: application => enforced, service =>
 * bypassed.
 */

const manageRule = access("thing", "manage", "Manage things", {
  pluginId: "target",
});

const targetContract = {
  // Gated by `thing.manage`. autoAuthMiddleware qualifies it to
  // `target.thing.manage` for the "target" plugin.
  manageThing: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [manageRule],
  }).output(z.object({ ok: z.boolean(), kind: z.string() })),
};

type RootClient = ContractRouterClient<{ target: typeof targetContract }>;

function buildTargetRouter() {
  const os = implement(targetContract)
    .$context<RpcContext>()
    .use(correlationMiddleware)
    .use(autoAuthMiddleware);
  return os.router({
    manageThing: os.manageThing.handler(async ({ context }) => ({
      ok: true,
      kind: context.user?.type ?? "anonymous",
    })),
  });
}

const noopEventBus: EventBus = {
  subscribe: async () => async () => {},
  emit: async () => {},
  emitLocal: async () => {},
  shutdown: async () => {},
};

/**
 * Maps bearer tokens to the principal kinds we want to contrast:
 * - `app-ok`   -> application HOLDING the qualified rule
 * - `app-deny` -> application WITHOUT the rule (must be refused)
 * - `svc`      -> trusted service (short-circuits all checks)
 */
const realAuth: AuthService = {
  async authenticate(request) {
    const header = request.headers.get("authorization");
    if (header === "Bearer app-ok") {
      return {
        type: "application",
        id: "app-ok",
        name: "Bounded App",
        accessRules: ["target.thing.manage"],
      } satisfies AuthUser;
    }
    if (header === "Bearer app-deny") {
      return {
        type: "application",
        id: "app-deny",
        name: "Under-privileged App",
        accessRules: [],
      } satisfies AuthUser;
    }
    if (header === "Bearer svc") {
      return { type: "service", pluginId: "automation" } satisfies AuthUser;
    }
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
  registry.register(coreServices.auth, realAuth);
  return registry;
}

const app = new Hono();
const apiHandler = createApiRouteHandler({
  registry: buildRegistry(),
  pluginRpcRouters: new Map<string, unknown>([["target", buildTargetRouter()]]),
  pluginHttpHandlers: new Map(),
  pluginMetadataRegistry: new Map([["target", { pluginId: "target" }]]),
});
registerApiRoute(app, apiHandler);

const listening = Bun.serve({ port: 0, fetch: app.fetch });
const baseUrl = `http://localhost:${listening.port}`;

afterAll(() => {
  listening.stop(true);
});

function clientWith(headers: Record<string, string>): RootClient {
  return createORPCClient<RootClient>(
    new RPCLink({ url: `${baseUrl}/api`, headers }),
  );
}

describe("app-principal authorization (real HTTP)", () => {
  test("an application HOLDING the rule is allowed (enforced, not bypassed)", async () => {
    const result = await clientWith({
      authorization: "Bearer app-ok",
    }).target.manageThing();
    expect(result).toEqual({ ok: true, kind: "application" });
  });

  test("an application WITHOUT the rule is FORBIDDEN - the security crux", async () => {
    // Proves the app-principal flows through full access-rule enforcement and is
    // NOT short-circuited like a service. This is the guarantee that an
    // automation can never exceed its service account's permissions.
    await expect(
      clientWith({ authorization: "Bearer app-deny" }).target.manageThing(),
    ).rejects.toThrow(/Missing access|FORBIDDEN/i);
  });

  test("a trusted service bypasses the check (the contrast we must NOT grant apps)", async () => {
    const result = await clientWith({
      authorization: "Bearer svc",
    }).target.manageThing();
    expect(result).toEqual({ ok: true, kind: "service" });
  });
});
