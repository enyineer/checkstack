import { describe, it, expect, beforeEach } from "bun:test";
import { pluginRegistry } from "@checkmate/frontend-api";
import { FrontendPlugin } from "@checkmate/frontend-api";
import React from "react";

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
    name: "test-plugin",
    extensions: [
      {
        id: "extension-1",
        slotId: "slot-a",
        component: () => React.createElement("div", null, "Hello"),
      },
    ],
    routes: [
      {
        path: "/test",
        element: React.createElement("div", null, "Test Route"),
      },
    ],
  };

  it("should register a plugin and its extensions", () => {
    pluginRegistry.register(mockPlugin);

    expect(pluginRegistry.getPlugins()).toContain(mockPlugin);
    const extensions = pluginRegistry.getExtensions("slot-a");
    expect(extensions).toHaveLength(1);
    expect(extensions[0].id).toBe("extension-1");
  });

  it("should return empty array for unknown slotId", () => {
    const extensions = pluginRegistry.getExtensions("unknown-slot");
    expect(extensions).toEqual([]);
  });

  it("should aggregate all routes from registered plugins", () => {
    const pluginB: FrontendPlugin = {
      name: "plugin-b",
      routes: [{ path: "/b" }],
    };

    pluginRegistry.register(mockPlugin);
    pluginRegistry.register(pluginB);

    const routes = pluginRegistry.getAllRoutes();
    expect(routes).toHaveLength(2);
    expect(routes.map((r) => r.path)).toContain("/test");
    expect(routes.map((r) => r.path)).toContain("/b");
  });
});
