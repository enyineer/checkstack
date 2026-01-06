import { describe, it, expect, beforeEach, mock } from "bun:test";
import { SignalServiceImpl } from "../src/signal-service-impl";
import { SIGNAL_BROADCAST_HOOK, SIGNAL_USER_HOOK } from "../src/hooks";
import { createSignal } from "@checkmate-monitor/signal-common";
import { z } from "zod";
import type { EventBus, Logger } from "@checkmate-monitor/backend-api";

// Test signals
const TEST_BROADCAST_SIGNAL = createSignal(
  "test.broadcast",
  z.object({ message: z.string() })
);

const TEST_USER_SIGNAL = createSignal(
  "test.user",
  z.object({ notification: z.string(), count: z.number() })
);

describe("SignalServiceImpl", () => {
  let signalService: SignalServiceImpl;
  let mockEventBus: EventBus;
  let mockLogger: Logger;
  let emittedEvents: Array<{ hook: unknown; payload: unknown }>;

  beforeEach(() => {
    emittedEvents = [];

    mockEventBus = {
      emit: mock(async (hook, payload) => {
        emittedEvents.push({ hook, payload });
      }),
      subscribe: mock(async () => {}),
      shutdown: mock(async () => {}),
    } as unknown as EventBus;

    mockLogger = {
      debug: mock(() => {}),
      info: mock(() => {}),
      warn: mock(() => {}),
      error: mock(() => {}),
      child: mock(() => mockLogger),
    } as unknown as Logger;

    signalService = new SignalServiceImpl(mockEventBus, mockLogger);
  });

  describe("broadcast", () => {
    it("should emit broadcast signal to EventBus", async () => {
      const payload = { message: "Hello, World!" };

      await signalService.broadcast(TEST_BROADCAST_SIGNAL, payload);

      expect(emittedEvents).toHaveLength(1);
      expect(emittedEvents[0].hook).toBe(SIGNAL_BROADCAST_HOOK);

      const message = emittedEvents[0].payload as {
        signalId: string;
        payload: typeof payload;
        timestamp: string;
      };
      expect(message.signalId).toBe("test.broadcast");
      expect(message.payload).toEqual(payload);
      expect(typeof message.timestamp).toBe("string");
    });

    it("should log debug message when broadcasting", async () => {
      await signalService.broadcast(TEST_BROADCAST_SIGNAL, {
        message: "Test",
      });

      expect(mockLogger.debug).toHaveBeenCalled();
    });

    it("should include ISO timestamp in signal message", async () => {
      const beforeTime = new Date().toISOString();
      await signalService.broadcast(TEST_BROADCAST_SIGNAL, {
        message: "Test",
      });
      const afterTime = new Date().toISOString();

      const message = emittedEvents[0].payload as { timestamp: string };
      expect(message.timestamp >= beforeTime).toBe(true);
      expect(message.timestamp <= afterTime).toBe(true);
    });
  });

  describe("sendToUser", () => {
    it("should emit user signal to EventBus with userId", async () => {
      const userId = "user-123";
      const payload = { notification: "New message", count: 5 };

      await signalService.sendToUser(TEST_USER_SIGNAL, userId, payload);

      expect(emittedEvents).toHaveLength(1);
      expect(emittedEvents[0].hook).toBe(SIGNAL_USER_HOOK);

      const emitted = emittedEvents[0].payload as {
        userId: string;
        message: { signalId: string; payload: typeof payload };
      };
      expect(emitted.userId).toBe(userId);
      expect(emitted.message.signalId).toBe("test.user");
      expect(emitted.message.payload).toEqual(payload);
    });

    it("should log debug message with user and signal info", async () => {
      await signalService.sendToUser(TEST_USER_SIGNAL, "user-456", {
        notification: "Alert",
        count: 1,
      });

      expect(mockLogger.debug).toHaveBeenCalled();
    });
  });

  describe("sendToUsers", () => {
    it("should emit signal to multiple users", async () => {
      const userIds = ["user-1", "user-2", "user-3"];
      const payload = { notification: "Broadcast to users", count: 10 };

      await signalService.sendToUsers(TEST_USER_SIGNAL, userIds, payload);

      // Should emit one event per user
      expect(emittedEvents).toHaveLength(3);

      for (const [index, event] of emittedEvents.entries()) {
        expect(event.hook).toBe(SIGNAL_USER_HOOK);
        const emitted = event.payload as { userId: string };
        expect(emitted.userId).toBe(userIds[index]);
      }
    });

    it("should handle empty user array", async () => {
      await signalService.sendToUsers(TEST_USER_SIGNAL, [], {
        notification: "Empty",
        count: 0,
      });

      expect(emittedEvents).toHaveLength(0);
    });

    it("should handle single user in array", async () => {
      await signalService.sendToUsers(TEST_USER_SIGNAL, ["single-user"], {
        notification: "Single",
        count: 1,
      });

      expect(emittedEvents).toHaveLength(1);
    });
  });
});

describe("Signal Hooks", () => {
  it("should have correct hook IDs", () => {
    expect(SIGNAL_BROADCAST_HOOK.id).toBe("signal.internal.broadcast");
    expect(SIGNAL_USER_HOOK.id).toBe("signal.internal.user");
  });

  it("should have consistent hook structure", () => {
    expect(SIGNAL_BROADCAST_HOOK).toHaveProperty("id");
    expect(SIGNAL_USER_HOOK).toHaveProperty("id");
  });
});
