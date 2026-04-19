import { describe, it, expect } from "bun:test";
import {
  WebSocketRouteStoreImpl,
  createScopedWsRegistry,
} from "./ws-route-registry";
import type { WebSocketRouteHandler } from "@checkstack/backend-api";

function createMockHandler(): WebSocketRouteHandler {
  return {
    onConnection: () => ({
      onMessage: () => {},
      onClose: () => {},
    }),
  };
}

describe("WebSocketRouteStoreImpl", () => {
  it("should register and retrieve a handler by full path", () => {
    const store = new WebSocketRouteStoreImpl();
    const handler = createMockHandler();

    store.registerHandler("satellite", handler);

    expect(store.getHandler("satellite")).toBe(handler);
  });

  it("should return undefined for unregistered paths", () => {
    const store = new WebSocketRouteStoreImpl();

    expect(store.getHandler("nonexistent")).toBeUndefined();
  });

  it("should reject duplicate registrations", () => {
    const store = new WebSocketRouteStoreImpl();
    const handler = createMockHandler();

    store.registerHandler("satellite", handler);

    expect(() => store.registerHandler("satellite", handler)).toThrow(
      "WebSocket route already registered: /api/ws/satellite",
    );
  });
});

describe("createScopedWsRegistry", () => {
  it('should auto-prefix pluginId when path is "/"', () => {
    const store = new WebSocketRouteStoreImpl();
    const scoped = createScopedWsRegistry(store, "satellite");
    const handler = createMockHandler();

    scoped.register("/", handler);

    expect(store.getHandler("satellite")).toBe(handler);
  });

  it("should auto-prefix pluginId with sub-path", () => {
    const store = new WebSocketRouteStoreImpl();
    const scoped = createScopedWsRegistry(store, "my-plugin");
    const handler = createMockHandler();

    scoped.register("/connect", handler);

    expect(store.getHandler("my-plugin/connect")).toBe(handler);
  });

  it("should namespace different plugins independently", () => {
    const store = new WebSocketRouteStoreImpl();
    const scopedA = createScopedWsRegistry(store, "plugin-a");
    const scopedB = createScopedWsRegistry(store, "plugin-b");
    const handlerA = createMockHandler();
    const handlerB = createMockHandler();

    scopedA.register("/", handlerA);
    scopedB.register("/", handlerB);

    expect(store.getHandler("plugin-a")).toBe(handlerA);
    expect(store.getHandler("plugin-b")).toBe(handlerB);
  });

  it("should prevent cross-plugin path collisions", () => {
    const store = new WebSocketRouteStoreImpl();
    const scopedA = createScopedWsRegistry(store, "plugin-a");
    const scopedB = createScopedWsRegistry(store, "plugin-a");
    const handler = createMockHandler();

    scopedA.register("/", handler);

    // Same pluginId + same path = collision
    expect(() => scopedB.register("/", handler)).toThrow(
      "WebSocket route already registered",
    );
  });
});
