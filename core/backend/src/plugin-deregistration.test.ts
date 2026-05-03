import { describe, it, expect, mock, beforeEach } from "bun:test";
import { PluginManager } from "./plugin-manager";

/**
 * Integration test for the originator/in-process split introduced in the
 * runtime plugin system.
 *
 * Key contract: `deregisterPluginInProcess` must NOT touch any persistent
 * state. It runs on every instance via the broadcast hook; the destructive
 * cleanup (drop schema, delete plugin_configs, delete plugin_artifacts,
 * delete plugins rows) only runs on the originator via `deletePluginData`.
 *
 * If a future refactor accidentally pushes destructive ops back into the
 * in-process path, these tests fire.
 */

describe("deregisterPluginInProcess", () => {
  let pluginManager: PluginManager;

  beforeEach(() => {
    pluginManager = new PluginManager();
  });

  it("clears in-memory cleanup handlers and runs them in LIFO order", async () => {
    const order: string[] = [];
    const handlerA = mock(async () => {
      order.push("a");
    });
    const handlerB = mock(async () => {
      order.push("b");
    });

    // Inject cleanup handlers using the same mechanism plugins use during
    // registration. We poke the private map because the public path (full
    // backendPlugin.register) needs a real plugin module.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handlers = (pluginManager as any).cleanupHandlers as Map<
      string,
      Array<() => Promise<void>>
    >;
    handlers.set("test-plugin", [handlerA, handlerB]);

    await pluginManager.deregisterPluginInProcess("test-plugin");

    // LIFO: handlerB ran before handlerA
    expect(order).toEqual(["b", "a"]);
    expect(handlers.has("test-plugin")).toBe(false);
  });

  it("removes router, contract, metadata and access-rule entries", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pm = pluginManager as any;
    pm.pluginRpcRouters.set("foo", { router: true });
    pm.pluginContractRegistry.set("foo", { contract: true });
    pm.pluginMetadataRegistry.set("foo", { pluginId: "foo" });
    pm.registeredAccessRules.push({
      id: "foo.something",
      pluginId: "foo",
      action: "read",
      resourceType: "thing",
      description: "test",
    });

    await pluginManager.deregisterPluginInProcess("foo");

    expect(pm.pluginRpcRouters.has("foo")).toBe(false);
    expect(pm.pluginContractRegistry.has("foo")).toBe(false);
    expect(pm.pluginMetadataRegistry.has("foo")).toBe(false);
    expect(
      pm.registeredAccessRules.some(
        (r: { pluginId: string }) => r.pluginId === "foo",
      ),
    ).toBe(false);
  });

  it("does not invoke any artifact-store or destructive ops", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pm = pluginManager as any;

    const artifactStoreCalls: string[] = [];
    const fakeArtifactStore = {
      maxArtifactSize: 1,
      store: () => {
        artifactStoreCalls.push("store");
        return Promise.resolve({ artifactId: "x", contentHash: "x" });
      },
      fetch: () => {
        artifactStoreCalls.push("fetch");
        return Promise.resolve(undefined);
      },
      fetchById: () => {
        artifactStoreCalls.push("fetchById");
        return Promise.resolve(undefined);
      },
      delete: () => {
        artifactStoreCalls.push("delete");
        return Promise.resolve();
      },
      deleteByBundle: () => {
        artifactStoreCalls.push("deleteByBundle");
        return Promise.resolve();
      },
    };
    // The artifact store is registered via coreServices.pluginArtifactStore.
    // Even when present, deregisterPluginInProcess should not consult it.
    pm.registry.register(
      { id: "core.pluginArtifactStore" },
      fakeArtifactStore,
    );

    pm.cleanupHandlers.set("foo", []);
    await pluginManager.deregisterPluginInProcess("foo");

    expect(artifactStoreCalls).toEqual([]);
  });

  it("handler errors do not block subsequent cleanup or remove-from-registry", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pm = pluginManager as any;

    const goodHandler = mock(async () => {});
    const badHandler = mock(async () => {
      throw new Error("intentional");
    });

    pm.cleanupHandlers.set("plugin-a", [goodHandler, badHandler]);
    pm.pluginRpcRouters.set("plugin-a", {});

    await pluginManager.deregisterPluginInProcess("plugin-a");

    expect(badHandler).toHaveBeenCalled();
    expect(goodHandler).toHaveBeenCalled();
    // Even though one handler threw, the in-memory state was cleared:
    expect(pm.pluginRpcRouters.has("plugin-a")).toBe(false);
    expect(pm.cleanupHandlers.has("plugin-a")).toBe(false);
  });
});
