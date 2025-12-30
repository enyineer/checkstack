import { describe, it, expect, beforeEach } from "bun:test";
import { EventBus } from "../services/event-bus";
import { createHook } from "@checkmate/backend-api";
import {
  createMockLogger,
  createMockQueueFactory,
} from "@checkmate/test-utils-backend";
import type { Logger } from "@checkmate/backend-api";
import type { QueueFactory } from "@checkmate/queue-api";

describe("EventBus Integration Tests", () => {
  let eventBus: EventBus;
  let mockQueueFactory: QueueFactory;
  let mockLogger: Logger;

  beforeEach(() => {
    mockQueueFactory = createMockQueueFactory();
    mockLogger = createMockLogger();
    eventBus = new EventBus(mockQueueFactory, mockLogger);
  });

  describe("Permission Sync Scenario", () => {
    it("should sync permissions across plugins using work-queue mode", async () => {
      // Simulate the permissionsRegistered hook
      const permissionsRegistered = createHook<{
        pluginId: string;
        permissions: Array<{ id: string; description?: string }>;
      }>("core.permissionsRegistered");

      const syncedPermissions: Array<{ id: string; description?: string }> = [];

      // Auth-backend subscribes to sync permissions (work-queue mode)
      await eventBus.subscribe(
        "auth-backend",
        permissionsRegistered,
        async ({ permissions }) => {
          // Simulate DB sync
          syncedPermissions.push(...permissions);
        },
        {
          mode: "work-queue",
          workerGroup: "permission-db-sync",
          maxRetries: 3,
        }
      );

      // Emit permission registration events from different plugins
      await eventBus.emit(permissionsRegistered, {
        pluginId: "catalog-backend",
        permissions: [
          { id: "catalog-backend.read", description: "Read catalog" },
          { id: "catalog-backend.manage", description: "Manage catalog" },
        ],
      });

      await eventBus.emit(permissionsRegistered, {
        pluginId: "queue-backend",
        permissions: [
          { id: "queue-backend.read", description: "Read queue" },
          { id: "queue-backend.manage", description: "Manage queue" },
        ],
      });

      // Wait for async processing
      await new Promise((resolve) => setTimeout(resolve, 100));

      // All permissions should be synced
      expect(syncedPermissions.length).toBe(4);
      expect(syncedPermissions.map((p) => p.id)).toContain(
        "catalog-backend.read"
      );
      expect(syncedPermissions.map((p) => p.id)).toContain(
        "catalog-backend.manage"
      );
      expect(syncedPermissions.map((p) => p.id)).toContain(
        "queue-backend.read"
      );
      expect(syncedPermissions.map((p) => p.id)).toContain(
        "queue-backend.manage"
      );
    });

    it("should distribute jobs across instances in work-queue mode", async () => {
      const testHook = createHook<{ data: string }>("test.hook");

      let instance1Count = 0;
      let instance2Count = 0;

      // Simulate two different backend instances (different plugin IDs)
      // Both use same workerGroup name but get namespaced differently
      await eventBus.subscribe(
        "plugin-instance-1",
        testHook,
        async () => {
          instance1Count++;
        },
        {
          mode: "work-queue",
          workerGroup: "sync",
        }
      );

      await eventBus.subscribe(
        "plugin-instance-2",
        testHook,
        async () => {
          instance2Count++;
        },
        {
          mode: "work-queue",
          workerGroup: "sync",
        }
      );

      // Emit multiple events
      await eventBus.emit(testHook, { data: "test1" });
      await eventBus.emit(testHook, { data: "test2" });
      await eventBus.emit(testHook, { data: "test3" });

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Both instances should process jobs (different namespaces due to different plugin IDs)
      const total = instance1Count + instance2Count;
      expect(total).toBe(6); // Each instance gets all 3 jobs (different namespaces)

      // Each instance should have processed the jobs
      expect(instance1Count).toBe(3);
      expect(instance2Count).toBe(3);
    });
  });

  describe("Broadcast Scenario", () => {
    it("should notify all plugin instances in broadcast mode", async () => {
      const configUpdated = createHook<{ key: string; value: string }>(
        "core.configUpdated"
      );

      const plugin1Notifications: string[] = [];
      const plugin2Notifications: string[] = [];

      // Multiple plugins subscribe to config updates
      await eventBus.subscribe("plugin-1", configUpdated, async ({ key }) => {
        plugin1Notifications.push(key);
      });

      await eventBus.subscribe("plugin-2", configUpdated, async ({ key }) => {
        plugin2Notifications.push(key);
      });

      // Emit config update
      await eventBus.emit(configUpdated, {
        key: "database.url",
        value: "postgresql://localhost",
      });

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Both plugins should receive the notification
      expect(plugin1Notifications).toContain("database.url");
      expect(plugin2Notifications).toContain("database.url");
    });
  });

  describe("Mixed Mode Scenario", () => {
    it("should handle both broadcast and work-queue for same hook", async () => {
      const dataProcessed = createHook<{ id: string }>("data.processed");

      const broadcastNotifications: string[] = [];
      const workQueueProcessed: string[] = [];

      // Broadcast subscriber (logging/monitoring)
      await eventBus.subscribe(
        "logger-plugin",
        dataProcessed,
        async ({ id }) => {
          broadcastNotifications.push(`logged-${id}`);
        }
      );

      // Work-queue subscribers (actual processing - only one should handle)
      await eventBus.subscribe(
        "processor-plugin",
        dataProcessed,
        async ({ id }) => {
          workQueueProcessed.push(`processed-${id}`);
        },
        {
          mode: "work-queue",
          workerGroup: "processor",
        }
      );

      // Different work-queue subscriber with different group
      await eventBus.subscribe(
        "archiver-plugin",
        dataProcessed,
        async ({ id }) => {
          workQueueProcessed.push(`archived-${id}`);
        },
        {
          mode: "work-queue",
          workerGroup: "archiver",
        }
      );

      // Emit event
      await eventBus.emit(dataProcessed, { id: "data-123" });

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Broadcast should always receive
      expect(broadcastNotifications).toContain("logged-data-123");

      // Work-queue should process (both groups should handle it)
      expect(workQueueProcessed).toContain("processed-data-123");
      expect(workQueueProcessed).toContain("archived-data-123");
      expect(workQueueProcessed.length).toBe(2);
    });
  });

  describe("Error Resilience", () => {
    it("should continue processing other listeners if one fails", async () => {
      const testHook = createHook<{ value: number }>("test.hook");

      const successful: number[] = [];

      // First listener fails
      await eventBus.subscribe("plugin-1", testHook, async () => {
        throw new Error("Simulated failure");
      });

      // Second listener succeeds
      await eventBus.subscribe("plugin-2", testHook, async ({ value }) => {
        successful.push(value);
      });

      // Third listener succeeds
      await eventBus.subscribe("plugin-3", testHook, async ({ value }) => {
        successful.push(value * 2);
      });

      await eventBus.emit(testHook, { value: 10 });

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Despite first listener failing, others should succeed
      expect(successful).toContain(10);
      expect(successful).toContain(20);
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe("Lifecycle", () => {
    it("should properly clean up on shutdown", async () => {
      const hook1 = createHook<{ test: string }>("hook1");
      const hook2 = createHook<{ test: string }>("hook2");

      await eventBus.subscribe("test-plugin", hook1, async () => {});
      await eventBus.subscribe("test-plugin", hook2, async () => {});

      await eventBus.shutdown();

      // Should log shutdown
      expect(mockLogger.info).toHaveBeenCalledWith("EventBus shut down");
    });

    it("should allow unsubscribe and re-subscribe with same workerGroup", async () => {
      const testHook = createHook<{ value: number }>("test.hook");
      const values: number[] = [];

      // Subscribe
      const unsub = await eventBus.subscribe(
        "test-plugin",
        testHook,
        async ({ value }) => {
          values.push(value);
        },
        {
          mode: "work-queue",
          workerGroup: "processor",
        }
      );

      await eventBus.emit(testHook, { value: 1 });
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(values).toContain(1);

      // Unsubscribe
      await unsub();

      // Re-subscribe with same workerGroup (should work)
      await eventBus.subscribe(
        "test-plugin",
        testHook,
        async ({ value }) => {
          values.push(value * 10);
        },
        {
          mode: "work-queue",
          workerGroup: "processor", // Same name OK after unsubscribe
        }
      );

      await eventBus.emit(testHook, { value: 2 });
      await new Promise((resolve) => setTimeout(resolve, 50));

      // First value from first subscription, second value from second subscription
      expect(values).toContain(1);
      expect(values).toContain(20); // 2 * 10
    });
  });
});
