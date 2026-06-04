import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { createBackendPlugin } from "@checkstack/backend-api";
import type { AccessRule, PluginMetadata } from "@checkstack/common";
import { ServiceRegistry } from "../services/service-registry";
import { createExtensionPointManager } from "./extension-points";
import { registerPlugin, type PluginLoaderDeps } from "./plugin-loader";
import type { PendingInit } from "./types";
import type { AnyContractRouter } from "@orpc/contract";
import { rootLogger } from "../logger";

/**
 * Regression coverage for the "no register() export" skip diagnostic.
 *
 * A package declared `checkstack.type: "backend"` is inserted into the
 * `plugins` table and loaded in Phase 1 via `pluginModule.default`. If that
 * default export is missing (a host-consumed library mis-typed as a backend
 * plugin, e.g. `@checkstack/signal-backend` before it was reclassified to
 * `tooling`), `backendPlugin` is `undefined` and the loader skips it.
 *
 * Previously the skip warning rendered the opaque literal "unknown" because
 * the only identifier source was `backendPlugin?.metadata?.pluginId`. These
 * tests assert the package name / path from the database row is used as a
 * fallback so the offending package is always identifiable, and that a valid
 * plugin loads without any warning.
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

// A module whose `default` export is missing models a package mis-typed as a
// backend plugin. `registerPlugin` accepts `BackendPlugin | undefined` precisely
// because `pluginModule.default` can be `undefined` at runtime, so no cast is
// needed to exercise the guard.
const missingDefaultExport = undefined;

describe("registerPlugin skip diagnostic", () => {
  let warnSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    warnSpy = spyOn(rootLogger, "warn").mockImplementation(() => rootLogger);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("names the package by its database-row name (never 'unknown') when the default export is missing", () => {
    const pendingInits: PendingInit[] = [];

    registerPlugin({
      backendPlugin: missingDefaultExport,
      pluginPath: "/workspace/core/signal-backend",
      pluginName: "@checkstack/signal-backend",
      pendingInits,
      providedBy: new Map<string, string>(),
      deps: makeDeps(new ServiceRegistry()),
    });

    expect(pendingInits).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const message = String(warnSpy.mock.calls[0]?.[0]);
    expect(message).toContain("@checkstack/signal-backend");
    expect(message).not.toContain("unknown");
  });

  it("falls back to the plugin path when no name is available", () => {
    const pendingInits: PendingInit[] = [];

    registerPlugin({
      backendPlugin: missingDefaultExport,
      pluginPath: "/workspace/core/mystery-backend",
      pendingInits,
      providedBy: new Map<string, string>(),
      deps: makeDeps(new ServiceRegistry()),
    });

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const message = String(warnSpy.mock.calls[0]?.[0]);
    expect(message).toContain("/workspace/core/mystery-backend");
    expect(message).not.toContain("unknown");
  });

  it("does not warn when a valid plugin with register() is registered", () => {
    const pendingInits: PendingInit[] = [];
    const plugin = createBackendPlugin({
      metadata: { pluginId: "valid-plugin" },
      register: () => {
        // no-op: a valid plugin must not trigger the skip diagnostic.
      },
    });

    registerPlugin({
      backendPlugin: plugin,
      pluginPath: "/workspace/core/valid-backend",
      pluginName: "@checkstack/valid-backend",
      pendingInits,
      providedBy: new Map<string, string>(),
      deps: makeDeps(new ServiceRegistry()),
    });

    expect(warnSpy).not.toHaveBeenCalled();
  });
});
