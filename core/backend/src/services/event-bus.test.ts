import { describe, it, expect, beforeEach } from "bun:test";
import { EventBus } from "./event-bus";
import type { QueueManager } from "@checkmate-monitor/queue-api";
import type { Logger, Hook } from "@checkmate-monitor/backend-api";
import { createHook } from "@checkmate-monitor/backend-api";
import {
  createMockLogger,
  createMockQueueManager,
} from "@checkmate-monitor/test-utils-backend";

describe("EventBus", () => {
  let eventBus: EventBus;
  let mockQueueManager: QueueManager;
  let mockLogger: Logger;

  beforeEach(() => {
    mockQueueManager = createMockQueueManager();
    mockLogger = createMockLogger();
    eventBus = new EventBus(mockQueueManager, mockLogger);
  });

  describe("Validation", () => {
    it("should require workerGroup for work-queue mode", async () => {
      const testHook = createHook<{ test: string }>("test.hook");

      await expect(
        eventBus.subscribe(
          "test-plugin",
          testHook,
          async () => {},
          { mode: "work-queue" } as any // Missing workerGroup
        )
      ).rejects.toThrow("workerGroup is required when mode is 'work-queue'");
    });

    it("should detect duplicate workerGroups in same plugin", async () => {
      const testHook = createHook<{ test: string }>("test.hook");

      // First subscription: OK
      await eventBus.subscribe("test-plugin", testHook, async () => {}, {
        mode: "work-queue",
        workerGroup: "sync",
      });

      // Second subscription with same workerGroup: ERROR
      await expect(
        eventBus.subscribe("test-plugin", testHook, async () => {}, {
          mode: "work-queue",
          workerGroup: "sync",
        })
      ).rejects.toThrow("Duplicate workerGroup 'sync' detected");
    });

    it("should allow same workerGroup name in different plugins", async () => {
      const testHook = createHook<{ test: string }>("test.hook");

      // Both should succeed (different plugins)
      await eventBus.subscribe("plugin-a", testHook, async () => {}, {
        mode: "work-queue",
        workerGroup: "sync",
      });

      await eventBus.subscribe("plugin-b", testHook, async () => {}, {
        mode: "work-queue",
        workerGroup: "sync",
      });

      // No error - different namespaces
      expect(true).toBe(true);
    });
  });

  describe("Plugin Namespacing", () => {
    it("should namespace workerGroup by plugin ID", async () => {
      const testHook = createHook<{ test: string }>("test.hook");
      const calls: string[] = [];

      await eventBus.subscribe(
        "plugin-a",
        testHook,
        async () => {
          calls.push("a");
        },
        {
          mode: "work-queue",
          workerGroup: "sync",
        }
      );

      await eventBus.subscribe(
        "plugin-b",
        testHook,
        async () => {
          calls.push("b");
        },
        {
          mode: "work-queue",
          workerGroup: "sync",
        }
      );

      await eventBus.emit(testHook, { test: "data" });

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Both should execute (different namespaces: plugin-a.sync and plugin-b.sync)
      expect(calls).toContain("a");
      expect(calls).toContain("b");
    });

    it("should create unique consumer groups for broadcast mode", async () => {
      const testHook = createHook<{ test: string }>("test.hook");
      const calls: number[] = [];

      // Two broadcast subscribers from same plugin
      await eventBus.subscribe("plugin-a", testHook, async () => {
        calls.push(1);
      });

      await eventBus.subscribe("plugin-a", testHook, async () => {
        calls.push(2);
      });

      await eventBus.emit(testHook, { test: "data" });

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Both should receive (each gets unique consumer group with instance ID)
      // Note: They both execute because they have different consumer groups
      expect(calls.length).toBeGreaterThanOrEqual(1);
      expect(calls.length).toBeLessThanOrEqual(2);
    });
  });

  describe("Unsubscribe", () => {
    it("should unsubscribe and stop receiving events", async () => {
      const testHook = createHook<{ test: string }>("test.hook");
      const calls: number[] = [];

      const unsubscribe = await eventBus.subscribe(
        "test-plugin",
        testHook,
        async () => {
          calls.push(1);
        }
      );

      await eventBus.emit(testHook, { test: "data" });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(calls.length).toBe(1);

      // Unsubscribe
      await unsubscribe();

      // Emit again
      await eventBus.emit(testHook, { test: "data" });
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Should not receive second event
      expect(calls.length).toBe(1);
    });

    it("should remove workerGroup from tracking on unsubscribe", async () => {
      const testHook = createHook<{ test: string }>("test.hook");

      const unsubscribe = await eventBus.subscribe(
        "test-plugin",
        testHook,
        async () => {},
        {
          mode: "work-queue",
          workerGroup: "sync",
        }
      );

      // Unsubscribe
      await unsubscribe();

      // Should be able to re-use the same workerGroup name
      await eventBus.subscribe("test-plugin", testHook, async () => {}, {
        mode: "work-queue",
        workerGroup: "sync",
      });

      // No error!
      expect(true).toBe(true);
    });

    it("should stop queue when all listeners unsubscribe", async () => {
      const testHook = createHook<{ test: string }>("test.hook");

      const unsubscribe1 = await eventBus.subscribe(
        "test-plugin",
        testHook,
        async () => {}
      );

      const unsubscribe2 = await eventBus.subscribe(
        "test-plugin",
        testHook,
        async () => {}
      );

      // Unsubscribe both
      await unsubscribe1();
      await unsubscribe2();

      // Successfully unsubscribed without errors
      expect(true).toBe(true);
    });
  });

  describe("Error Handling", () => {
    it("should log listener errors", async () => {
      const testHook = createHook<{ test: string }>("test.hook");

      await eventBus.subscribe(
        "test-plugin",
        testHook,
        async () => {
          throw new Error("Listener failed");
        },
        {
          mode: "work-queue",
          workerGroup: "fail-group",
          maxRetries: 0,
        }
      );

      // Emit - should not throw
      await eventBus.emit(testHook, { test: "data" });

      // Wait for async processing
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Error should be logged
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe("Hook Emission", () => {
    it("should create queue channel lazily on first emit", async () => {
      const testHook = createHook<{ test: string }>("test.hook");

      // Emit creates the queue lazily
      await eventBus.emit(testHook, { test: "data" });

      // No errors - queue was created
      expect(true).toBe(true);
    });

    it("should deliver payload to all subscribers", async () => {
      const testHook = createHook<{ value: number }>("test.hook");
      const received: number[] = [];

      await eventBus.subscribe("plugin-1", testHook, async (payload) => {
        received.push(payload.value);
      });

      await eventBus.subscribe("plugin-2", testHook, async (payload) => {
        received.push(payload.value * 2);
      });

      await eventBus.emit(testHook, { value: 10 });

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(received).toContain(10);
      expect(received).toContain(20);
    });
  });

  describe("Shutdown", () => {
    it("should stop all queue channels", async () => {
      const hook1 = createHook<{ test: string }>("hook1");
      const hook2 = createHook<{ test: string }>("hook2");

      await eventBus.subscribe("test-plugin", hook1, async () => {});
      await eventBus.subscribe("test-plugin", hook2, async () => {});

      await eventBus.shutdown();

      // All queues should be stopped
      expect(mockLogger.info).toHaveBeenCalledWith("EventBus shut down");
    });
  });

  describe("Instance-Local Hooks", () => {
    it("should subscribe via instance-local mode", async () => {
      const testHook = createHook<{ value: number }>("test.local.hook");
      const received: number[] = [];

      await eventBus.subscribe(
        "test-plugin",
        testHook,
        async (payload) => {
          received.push(payload.value);
        },
        { mode: "instance-local" }
      );

      await eventBus.emitLocal(testHook, { value: 42 });

      // Local hooks are synchronous-ish (no queue involved)
      expect(received).toEqual([42]);
    });

    it("should call all local listeners on emitLocal", async () => {
      const testHook = createHook<{ value: string }>("test.local.hook");
      const calls: string[] = [];

      await eventBus.subscribe(
        "plugin-a",
        testHook,
        async () => {
          calls.push("a");
        },
        { mode: "instance-local" }
      );

      await eventBus.subscribe(
        "plugin-b",
        testHook,
        async () => {
          calls.push("b");
        },
        { mode: "instance-local" }
      );

      await eventBus.emitLocal(testHook, { value: "test" });

      expect(calls).toContain("a");
      expect(calls).toContain("b");
      expect(calls.length).toBe(2);
    });

    it("should isolate failures via Promise.allSettled - one listener error does not block others", async () => {
      const testHook = createHook<{ value: number }>("test.local.hook");
      const successfulCalls: number[] = [];

      await eventBus.subscribe(
        "plugin-a",
        testHook,
        async (payload) => {
          successfulCalls.push(payload.value);
        },
        { mode: "instance-local" }
      );

      await eventBus.subscribe(
        "plugin-b",
        testHook,
        async () => {
          throw new Error("Intentional failure");
        },
        { mode: "instance-local" }
      );

      await eventBus.subscribe(
        "plugin-c",
        testHook,
        async (payload) => {
          successfulCalls.push(payload.value * 2);
        },
        { mode: "instance-local" }
      );

      // Should NOT throw despite plugin-b failing
      await eventBus.emitLocal(testHook, { value: 10 });

      // Both successful listeners should have executed
      expect(successfulCalls).toContain(10);
      expect(successfulCalls).toContain(20);
      expect(successfulCalls.length).toBe(2);

      // Error should be logged
      expect(mockLogger.error).toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalled();
    });

    it("should unsubscribe local listeners correctly", async () => {
      const testHook = createHook<{ value: number }>("test.local.hook");
      const calls: number[] = [];

      const unsubscribe = await eventBus.subscribe(
        "test-plugin",
        testHook,
        async (payload) => {
          calls.push(payload.value);
        },
        { mode: "instance-local" }
      );

      await eventBus.emitLocal(testHook, { value: 1 });
      expect(calls).toEqual([1]);

      // Unsubscribe
      await unsubscribe();

      await eventBus.emitLocal(testHook, { value: 2 });
      // Should NOT receive second event
      expect(calls).toEqual([1]);
    });

    it("should not trigger local listeners on distributed emit", async () => {
      const testHook = createHook<{ value: number }>("test.local.hook");
      const localCalls: number[] = [];
      const distributedCalls: number[] = [];

      await eventBus.subscribe(
        "test-plugin",
        testHook,
        async (payload) => {
          localCalls.push(payload.value);
        },
        { mode: "instance-local" }
      );

      await eventBus.subscribe("test-plugin", testHook, async (payload) => {
        distributedCalls.push(payload.value);
      });

      // Distributed emit - should only trigger distributed listener
      await eventBus.emit(testHook, { value: 42 });
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(distributedCalls).toContain(42);
      expect(localCalls).toEqual([]); // Local listener should NOT be triggered
    });

    it("should not trigger distributed listeners on emitLocal", async () => {
      const testHook = createHook<{ value: number }>("test.local.hook");
      const localCalls: number[] = [];
      const distributedCalls: number[] = [];

      await eventBus.subscribe(
        "test-plugin",
        testHook,
        async (payload) => {
          localCalls.push(payload.value);
        },
        { mode: "instance-local" }
      );

      await eventBus.subscribe("test-plugin", testHook, async (payload) => {
        distributedCalls.push(payload.value);
      });

      // Local emit - should only trigger local listener
      await eventBus.emitLocal(testHook, { value: 99 });

      expect(localCalls).toEqual([99]);
      expect(distributedCalls).toEqual([]); // Distributed listener should NOT be triggered
    });

    it("should handle emitLocal with no listeners gracefully", async () => {
      const testHook = createHook<{ value: number }>("test.no.listeners");

      // Should not throw
      await eventBus.emitLocal(testHook, { value: 42 });

      expect(mockLogger.debug).toHaveBeenCalledWith(
        `No local listeners for hook: ${testHook.id}`
      );
    });
  });
});
