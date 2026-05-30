import { describe, it, expect } from "bun:test";
import {
  createServiceRef,
  createBackendPlugin,
  type BackendPluginRegistry,
  type ServiceRef,
} from "@checkstack/backend-api";
import type { AccessRule, PluginMetadata } from "@checkstack/common";
import { ServiceRegistry } from "../services/service-registry";
import { createExtensionPointManager } from "./extension-points";
import { registerPlugin, type PluginLoaderDeps } from "./plugin-loader";
import type { PendingInit } from "./types";
import type { AnyContractRouter } from "@orpc/contract";

/**
 * Framework-level coverage for the plugin `env.getService`, the registry-backed
 * resolver added so the automation dispatch path can resolve arbitrary
 * cross-plugin refs (connection store, secret resolver) at execute time.
 *
 * Prior to this, `env` exposed `registerService` but NO resolver, so the
 * dispatch engine stubbed `getService` with a throwing placeholder and every
 * provider action threw in production. These tests assert `env.getService`
 * resolves through the REAL `ServiceRegistry` and fails loudly on a missing
 * ref (never silently `undefined`).
 */

function makeDeps(registry: ServiceRegistry): PluginLoaderDeps {
  return {
    registry,
    pluginRpcRouters: new Map<string, unknown>(),
    pluginHttpHandlers: new Map<string, (req: Request) => Promise<Response>>(),
    extensionPointManager: createExtensionPointManager(),
    registeredAccessRules: [] as (AccessRule & { pluginId: string })[],
    getAllAccessRules: () => [],
    db: {} as PluginLoaderDeps["db"],
    pluginMetadataRegistry: new Map<string, PluginMetadata>(),
    cleanupHandlers: new Map<string, Array<() => Promise<void>>>(),
    pluginContractRegistry: new Map<string, AnyContractRouter>(),
  };
}

/**
 * Register a no-op plugin whose `register` callback captures the `env` so the
 * test can call `env.getService` the same way a plugin would at init time.
 */
function captureEnv(deps: PluginLoaderDeps): BackendPluginRegistry {
  let captured: BackendPluginRegistry | undefined;
  const plugin = createBackendPlugin({
    metadata: { pluginId: "consumer-plugin" },
    register: (env) => {
      captured = env;
    },
  });
  const pendingInits: PendingInit[] = [];
  registerPlugin({
    backendPlugin: plugin,
    pluginPath: "/virtual/consumer-plugin",
    pendingInits,
    providedBy: new Map<string, string>(),
    deps,
  });
  if (!captured) throw new Error("env was not captured");
  return captured;
}

describe("plugin env.getService", () => {
  it("resolves a service registered by another plugin through the real ServiceRegistry", async () => {
    const registry = new ServiceRegistry();
    const ref = createServiceRef<{ ping: () => string }>("other.service");
    const impl = { ping: () => "pong" };
    registry.register(ref, impl);

    const env = captureEnv(makeDeps(registry));
    const resolved = await env.getService(ref);

    expect(resolved).toBe(impl);
    expect(resolved.ping()).toBe("pong");
  });

  it("resolves a service the SAME plugin registered via env.registerService", async () => {
    const registry = new ServiceRegistry();
    const env = captureEnv(makeDeps(registry));
    const ref = createServiceRef<{ n: number }>("self.service");

    env.registerService(ref, { n: 42 });
    const resolved = await env.getService(ref);

    expect(resolved.n).toBe(42);
  });

  it("throws a clear error (never undefined) when the ref is not registered", async () => {
    const registry = new ServiceRegistry();
    const env = captureEnv(makeDeps(registry));
    const missing: ServiceRef<{ x: number }> =
      createServiceRef<{ x: number }>("missing.service");

    let error: unknown;
    try {
      await env.getService(missing);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("missing.service");
    // Consumer identity is THIS plugin (audit / scoped factories).
    expect((error as Error).message).toContain("consumer-plugin");
  });
});
