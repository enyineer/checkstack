import { describe, it, expect, mock } from "bun:test";
import { createQueueRouter } from "./router";
import { createMockRpcContext } from "@checkstack/backend-api";
import { call } from "@orpc/server";
import { z } from "zod";

describe("Queue Router", () => {
  const mockUser = {
    id: "test-user",
    accessRules: ["*"],
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

  const mockManager: any = {
    getActivePlugin: mock(() => "memory"),
    setActiveBackend: mock(() =>
      Promise.resolve({ success: true, migratedRecurringJobs: 0, warnings: [] })
    ),
    getAggregatedStats: mock(() =>
      Promise.resolve({
        pending: 50,
        processing: 5,
        completed: 100,
        failed: 2,
        consumerGroups: 3,
        scope: "instance" as const,
      })
    ),
    listJobs: mock(() =>
      Promise.resolve({ items: [], total: 0, hasMore: false })
    ),
  };

  const mockConfigService: any = {
    getRedacted: mock(() => Promise.resolve({ concurrency: 10 })),
    get: mock(() => Promise.resolve(undefined)),
    set: mock(() => Promise.resolve()),
  };

  const router = createQueueRouter(mockConfigService);

  it("getPlugins returns list of plugins", async () => {
    const context = createMockRpcContext({
      user: mockUser,
      queuePluginRegistry: mockRegistry,
    });

    const result = await call(router.getPlugins, undefined, { context });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("memory");
  });

  it("getConfiguration returns redacted config", async () => {
    const context = createMockRpcContext({
      user: mockUser,
      queuePluginRegistry: mockRegistry,
      queueManager: mockManager,
    });

    const result = await call(router.getConfiguration, undefined, { context });
    expect(result.pluginId).toBe("memory");
    expect(result.config).toEqual({ concurrency: 10 });
    expect(mockConfigService.getRedacted).toHaveBeenCalledWith(
      "memory",
      mockPlugins[0].configSchema,
      mockPlugins[0].configVersion
    );
  });

  it("updateConfiguration updates active plugin", async () => {
    const context = createMockRpcContext({
      user: mockUser,
      queueManager: mockManager,
    });

    const result = await call(
      router.updateConfiguration,
      { pluginId: "memory", config: {} },
      { context }
    );
    expect(result.pluginId).toBe("memory");
    expect(mockManager.setActiveBackend).toHaveBeenCalled();
  });

  describe("Queue Stats", () => {
    it("getStats returns aggregated stats from QueueManager", async () => {
      const context = createMockRpcContext({
        user: mockUser,
        queueManager: mockManager,
      });

      const result = await call(router.getStats, undefined, { context });
      expect(result.pending).toBe(50);
      expect(result.processing).toBe(5);
      expect(result.completed).toBe(100);
      expect(result.failed).toBe(2);
      expect(mockManager.getAggregatedStats).toHaveBeenCalled();
    });
  });

  describe("Queue Lag Status", () => {
    it("getLagStatus returns 'none' severity when pending is below warning threshold", async () => {
      const lowPendingManager = {
        ...mockManager,
        getAggregatedStats: mock(() => Promise.resolve({ pending: 50 })),
      };
      const context = createMockRpcContext({
        user: mockUser,
        queueManager: lowPendingManager,
      });

      const result = await call(router.getLagStatus, undefined, { context });
      expect(result.severity).toBe("none");
      expect(result.pending).toBe(50);
      expect(result.thresholds.warningThreshold).toBe(100);
      expect(result.thresholds.criticalThreshold).toBe(500);
    });

    it("getLagStatus returns 'warning' severity when pending exceeds warning threshold", async () => {
      const warningPendingManager = {
        ...mockManager,
        getAggregatedStats: mock(() => Promise.resolve({ pending: 150 })),
      };
      const context = createMockRpcContext({
        user: mockUser,
        queueManager: warningPendingManager,
      });

      const result = await call(router.getLagStatus, undefined, { context });
      expect(result.severity).toBe("warning");
      expect(result.pending).toBe(150);
    });

    it("getLagStatus returns 'critical' severity when pending exceeds critical threshold", async () => {
      const criticalPendingManager = {
        ...mockManager,
        getAggregatedStats: mock(() => Promise.resolve({ pending: 600 })),
      };
      const context = createMockRpcContext({
        user: mockUser,
        queueManager: criticalPendingManager,
      });

      const result = await call(router.getLagStatus, undefined, { context });
      expect(result.severity).toBe("critical");
      expect(result.pending).toBe(600);
    });

    it("getLagStatus uses custom thresholds from config", async () => {
      const customConfigService = {
        ...mockConfigService,
        get: mock(() =>
          Promise.resolve({
            warningThreshold: 20,
            criticalThreshold: 50,
          })
        ),
      };
      const customRouter = createQueueRouter(customConfigService);
      const pendingManager = {
        ...mockManager,
        getAggregatedStats: mock(() => Promise.resolve({ pending: 30 })),
      };
      const context = createMockRpcContext({
        user: mockUser,
        queueManager: pendingManager,
      });

      const result = await call(customRouter.getLagStatus, undefined, {
        context,
      });
      expect(result.severity).toBe("warning");
      expect(result.thresholds.warningThreshold).toBe(20);
      expect(result.thresholds.criticalThreshold).toBe(50);
    });
  });

  describe("Update Lag Thresholds", () => {
    it("updateLagThresholds stores new thresholds", async () => {
      const context = createMockRpcContext({
        user: mockUser,
      });

      const result = await call(
        router.updateLagThresholds,
        { warningThreshold: 200, criticalThreshold: 1000 },
        { context }
      );

      expect(result.warningThreshold).toBe(200);
      expect(result.criticalThreshold).toBe(1000);
      expect(mockConfigService.set).toHaveBeenCalled();
    });

    it("updateLagThresholds rejects if warning >= critical", async () => {
      const context = createMockRpcContext({
        user: mockUser,
      });

      await expect(
        call(
          router.updateLagThresholds,
          { warningThreshold: 500, criticalThreshold: 100 },
          { context }
        )
      ).rejects.toThrow(
        "Warning threshold must be less than critical threshold"
      );
    });
  });
});
