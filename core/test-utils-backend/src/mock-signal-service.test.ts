import { describe, it, expect, beforeEach } from "bun:test";
import {
  createMockSignalService,
  type MockSignalService,
} from "../src/mock-signal-service";
import { createSignal } from "@checkmate-monitor/signal-common";
import { z } from "zod";

// Test signals
const TEST_SIGNAL_A = createSignal(
  "test.signalA",
  z.object({ value: z.string() })
);

const TEST_SIGNAL_B = createSignal(
  "test.signalB",
  z.object({ count: z.number() })
);

describe("createMockSignalService", () => {
  let mockService: MockSignalService;

  beforeEach(() => {
    mockService = createMockSignalService();
  });

  describe("broadcast", () => {
    it("should record broadcast signals", async () => {
      await mockService.broadcast(TEST_SIGNAL_A, { value: "hello" });

      const recorded = mockService.getRecordedSignals();
      expect(recorded).toHaveLength(1);
      expect(recorded[0].targetType).toBe("broadcast");
      expect(recorded[0].signal.id).toBe("test.signalA");
      expect(recorded[0].payload).toEqual({ value: "hello" });
    });

    it("should record timestamp", async () => {
      const before = new Date();
      await mockService.broadcast(TEST_SIGNAL_A, { value: "test" });
      const after = new Date();

      const recorded = mockService.getRecordedSignals()[0];
      expect(recorded.timestamp.getTime()).toBeGreaterThanOrEqual(
        before.getTime()
      );
      expect(recorded.timestamp.getTime()).toBeLessThanOrEqual(after.getTime());
    });
  });

  describe("sendToUser", () => {
    it("should record user-targeted signals with userId", async () => {
      await mockService.sendToUser(TEST_SIGNAL_B, "user-123", { count: 42 });

      const recorded = mockService.getRecordedSignals();
      expect(recorded).toHaveLength(1);
      expect(recorded[0].targetType).toBe("user");
      expect(recorded[0].userIds).toEqual(["user-123"]);
      expect(recorded[0].payload).toEqual({ count: 42 });
    });
  });

  describe("sendToUsers", () => {
    it("should record multi-user signals with all userIds", async () => {
      const userIds = ["user-1", "user-2", "user-3"];
      await mockService.sendToUsers(TEST_SIGNAL_A, userIds, { value: "multi" });

      const recorded = mockService.getRecordedSignals();
      expect(recorded).toHaveLength(1);
      expect(recorded[0].targetType).toBe("users");
      expect(recorded[0].userIds).toEqual(userIds);
    });
  });

  describe("getRecordedSignalsById", () => {
    it("should filter signals by ID", async () => {
      await mockService.broadcast(TEST_SIGNAL_A, { value: "a1" });
      await mockService.broadcast(TEST_SIGNAL_B, { count: 1 });
      await mockService.broadcast(TEST_SIGNAL_A, { value: "a2" });

      const signalARecords = mockService.getRecordedSignalsById("test.signalA");
      expect(signalARecords).toHaveLength(2);
      expect(signalARecords[0].payload).toEqual({ value: "a1" });
      expect(signalARecords[1].payload).toEqual({ value: "a2" });
    });

    it("should return empty array for non-existent signal ID", () => {
      const records = mockService.getRecordedSignalsById("non.existent");
      expect(records).toHaveLength(0);
    });
  });

  describe("getRecordedSignalsForUser", () => {
    it("should return broadcasts and user-specific signals", async () => {
      await mockService.broadcast(TEST_SIGNAL_A, { value: "broadcast" });
      await mockService.sendToUser(TEST_SIGNAL_B, "user-1", { count: 10 });
      await mockService.sendToUser(TEST_SIGNAL_B, "user-2", { count: 20 });

      const user1Signals = mockService.getRecordedSignalsForUser("user-1");
      expect(user1Signals).toHaveLength(2); // broadcast + user-specific

      const user2Signals = mockService.getRecordedSignalsForUser("user-2");
      expect(user2Signals).toHaveLength(2); // broadcast + user-specific
    });

    it("should include multi-user signals", async () => {
      await mockService.sendToUsers(TEST_SIGNAL_A, ["user-1", "user-2"], {
        value: "multi",
      });

      const user1Signals = mockService.getRecordedSignalsForUser("user-1");
      expect(user1Signals).toHaveLength(1);

      const user3Signals = mockService.getRecordedSignalsForUser("user-3");
      expect(user3Signals).toHaveLength(0); // Not included in multi-user
    });
  });

  describe("clearRecordedSignals", () => {
    it("should clear all recorded signals", async () => {
      await mockService.broadcast(TEST_SIGNAL_A, { value: "test" });
      await mockService.sendToUser(TEST_SIGNAL_B, "user-1", { count: 1 });

      expect(mockService.getRecordedSignals()).toHaveLength(2);

      mockService.clearRecordedSignals();

      expect(mockService.getRecordedSignals()).toHaveLength(0);
    });
  });

  describe("wasSignalEmitted", () => {
    it("should return true if signal was emitted", async () => {
      await mockService.broadcast(TEST_SIGNAL_A, { value: "test" });

      expect(mockService.wasSignalEmitted("test.signalA")).toBe(true);
      expect(mockService.wasSignalEmitted("test.signalB")).toBe(false);
    });
  });

  describe("wasSignalSentToUser", () => {
    it("should return true if signal was sent to specific user", async () => {
      await mockService.sendToUser(TEST_SIGNAL_A, "user-123", { value: "hi" });

      expect(mockService.wasSignalSentToUser("test.signalA", "user-123")).toBe(
        true
      );
      expect(mockService.wasSignalSentToUser("test.signalA", "user-456")).toBe(
        false
      );
      expect(mockService.wasSignalSentToUser("test.signalB", "user-123")).toBe(
        false
      );
    });

    it("should work with sendToUsers", async () => {
      await mockService.sendToUsers(TEST_SIGNAL_B, ["user-1", "user-2"], {
        count: 5,
      });

      expect(mockService.wasSignalSentToUser("test.signalB", "user-1")).toBe(
        true
      );
      expect(mockService.wasSignalSentToUser("test.signalB", "user-2")).toBe(
        true
      );
      expect(mockService.wasSignalSentToUser("test.signalB", "user-3")).toBe(
        false
      );
    });
  });

  describe("multiple signal mixtures", () => {
    it("should correctly track complex emission patterns", async () => {
      // Simulate realistic notification scenario
      await mockService.broadcast(TEST_SIGNAL_A, { value: "system-alert" });
      await mockService.sendToUser(TEST_SIGNAL_B, "admin-1", { count: 5 });
      await mockService.sendToUser(TEST_SIGNAL_B, "admin-2", { count: 3 });
      await mockService.sendToUsers(TEST_SIGNAL_A, ["user-1", "user-2"], {
        value: "team-update",
      });
      await mockService.broadcast(TEST_SIGNAL_B, { count: 100 });

      // Total signals
      expect(mockService.getRecordedSignals()).toHaveLength(5);

      // By signal ID
      expect(mockService.getRecordedSignalsById("test.signalA")).toHaveLength(
        2
      );
      expect(mockService.getRecordedSignalsById("test.signalB")).toHaveLength(
        3
      );

      // For specific users
      expect(mockService.getRecordedSignalsForUser("admin-1")).toHaveLength(3); // 2 broadcast + 1 user
      expect(mockService.getRecordedSignalsForUser("user-1")).toHaveLength(3); // 2 broadcast + 1 multi

      // Emission checks
      expect(mockService.wasSignalEmitted("test.signalA")).toBe(true);
      expect(mockService.wasSignalSentToUser("test.signalB", "admin-1")).toBe(
        true
      );
    });
  });
});
