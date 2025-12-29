import { describe, it, expect, mock } from "bun:test";
import { createQueueRouter } from "./router";
import { createMockRpcContext } from "@checkmate/backend-api";
import { call } from "@orpc/server";
import { z } from "zod";

describe("Queue Router", () => {
  const mockUser = {
    id: "test-user",
    permissions: ["*"],
    roles: ["admin"],
  } as any;

  const mockPlugins = [
    {
      id: "memory",
      displayName: "In-Memory Queue",
      description: "Simple in-memory queue for testing",
      configVersion: 1,
      configSchema: z.object({}),
    },
  ];

  const mockRegistry: any = {
    getPlugins: mock(() => mockPlugins),
    getPlugin: mock((id: string) => mockPlugins.find((p) => p.id === id)),
  };

  const mockFactory: any = {
    getActivePlugin: mock(() => "memory"),
    setActivePlugin: mock(() => Promise.resolve()),
  };

  const router = createQueueRouter();

  it("getPlugins returns list of plugins", async () => {
    const context = createMockRpcContext({
      user: mockUser,
      queuePluginRegistry: mockRegistry,
    });

    const result = await call(router.getPlugins, undefined, { context });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("memory");
  });

  it("getConfiguration returns active plugin config", async () => {
    const context = createMockRpcContext({
      user: mockUser,
      queuePluginRegistry: mockRegistry,
      queueFactory: mockFactory,
    });

    const result = await call(router.getConfiguration, undefined, { context });
    expect(result.pluginId).toBe("memory");
  });

  it("updateConfiguration updates active plugin", async () => {
    const context = createMockRpcContext({
      user: mockUser,
      queueFactory: mockFactory,
    });

    const result = await call(
      router.updateConfiguration,
      { pluginId: "memory", config: {} },
      { context }
    );
    expect(result.pluginId).toBe("memory");
    expect(mockFactory.setActivePlugin).toHaveBeenCalled();
  });
});
