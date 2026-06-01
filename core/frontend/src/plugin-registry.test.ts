import { describe, it, expect, beforeEach } from "bun:test";
import { pluginRegistry, createSlot } from "@checkstack/frontend-api";
import { FrontendPlugin } from "@checkstack/frontend-api";
import { createRoutes } from "@checkstack/common";
import React from "react";

// Create test slots
const slotA = createSlot("slot-a");
const sharedSlot = createSlot("shared-slot");

// Create test routes using the new pattern
const testRoutes = createRoutes("test", {
  home: "/",
  config: "/config",
});

const pluginBRoutes = createRoutes("plugin-b", {
  home: "/",
});

describe("PluginRegistry", () => {
  beforeEach(() => {
    // Clear the registry before each test.
    // Since it's a singleton, we need to manually clear its private state if possible,
    // or just accept that it's additive if we don't want to refactor.
    // Let's refactor the registry to be a class we can instantiate for testing.
    // For now, I'll just check if I can clear it.
    pluginRegistry.reset();
  });

  const mockPlugin: FrontendPlugin = {
    metadata: { pluginId: "test" },
    extensions: [
      {
        id: "extension-1",
        slot: slotA,
        component: () => React.createElement("div", null, "Hello"),
      },
    ],
    routes: [
      {
        route: testRoutes.routes.home,
        element: React.createElement("div", null, "Test Route"),
      },
    ],
  };

  it("should register a plugin and its extensions", () => {
    pluginRegistry.register(mockPlugin);

    expect(pluginRegistry.getPlugins()).toContain(mockPlugin);
    const extensions = pluginRegistry.getExtensions(slotA.id);
    expect(extensions).toHaveLength(1);
    expect(extensions[0].id).toBe("extension-1");
  });

  it("should return empty array for unknown slotId", () => {
    const extensions = pluginRegistry.getExtensions("unknown-slot");
    expect(extensions).toEqual([]);
  });

  it("should aggregate all routes from registered plugins", () => {
    const pluginB: FrontendPlugin = {
      metadata: { pluginId: "plugin-b" },
      routes: [
        {
          route: pluginBRoutes.routes.home,
          element: React.createElement("div", null, "Plugin B Route"),
        },
      ],
    };

    pluginRegistry.register(mockPlugin);
    pluginRegistry.register(pluginB);

    const routes = pluginRegistry.getAllRoutes();
    expect(routes).toHaveLength(2);
    expect(routes.map((r) => r.path)).toContain("/test/");
    expect(routes.map((r) => r.path)).toContain("/plugin-b/");
  });

  it("should allow multiple plugins to register extensions for the same slot", () => {
    const pluginA: FrontendPlugin = {
      metadata: { pluginId: "plugin-a" },
      extensions: [
        {
          id: "ext-a",
          slot: sharedSlot,
          component: () => React.createElement("div", null, "A"),
        },
      ],
    };

    const pluginB: FrontendPlugin = {
      metadata: { pluginId: "plugin-b" },
      extensions: [
        {
          id: "ext-b",
          slot: sharedSlot,
          component: () => React.createElement("div", null, "B"),
        },
      ],
    };

    pluginRegistry.register(pluginA);
    pluginRegistry.register(pluginB);

    const extensions = pluginRegistry.getExtensions(sharedSlot.id);
    expect(extensions).toHaveLength(2);
    expect(extensions.map((e) => e.id)).toContain("ext-a");
    expect(extensions.map((e) => e.id)).toContain("ext-b");
  });

  it("getAllRoutes preserves both eager (element) and lazy (load) routes", () => {
    const loader = () =>
      Promise.resolve({
        default: () => React.createElement("div", null, "Lazy"),
      });
    const plugin: FrontendPlugin = {
      metadata: { pluginId: "test" },
      routes: [
        { route: testRoutes.routes.home, element: React.createElement("div") },
        { route: testRoutes.routes.config, load: loader },
      ],
    };
    pluginRegistry.register(plugin);

    const routes = pluginRegistry.getAllRoutes();
    const home = routes.find((r) => r.path === "/test/");
    const config = routes.find((r) => r.path === "/test/config");
    expect(home?.element).toBeDefined();
    expect(home?.load).toBeUndefined();
    expect(config?.load).toBe(loader);
    expect(config?.element).toBeUndefined();
  });

  it("getPlugins returns a NEW snapshot reference on every change", () => {
    // Required for useSyncExternalStore / useMemo consumers to recompute when
    // a plugin is added or removed at runtime.
    const before = pluginRegistry.getPlugins();
    pluginRegistry.register(mockPlugin);
    const afterRegister = pluginRegistry.getPlugins();
    expect(afterRegister).not.toBe(before);
    expect(afterRegister).toContain(mockPlugin);

    pluginRegistry.unregister("test");
    const afterUnregister = pluginRegistry.getPlugins();
    expect(afterUnregister).not.toBe(afterRegister);
    expect(afterUnregister).not.toContain(mockPlugin);
  });

  it("notifies subscribers on register and unregister", () => {
    let calls = 0;
    const unsubscribe = pluginRegistry.subscribe(() => {
      calls += 1;
    });
    pluginRegistry.register(mockPlugin);
    pluginRegistry.unregister("test");
    expect(calls).toBe(2);

    unsubscribe();
    pluginRegistry.register(mockPlugin);
    expect(calls).toBe(2); // no longer notified after unsubscribe
  });
});
