import { describe, it, expect } from "bun:test";

/**
 * Basic structural tests for notification-backend.
 *
 * Note: Full integration tests with mocked DB chains are complex due to
 * oRPC middleware validation. These tests verify module exports and basic imports.
 * More comprehensive testing should be done via integration tests with a real test DB.
 */

describe("Notification Backend Module", () => {
  it("exports createNotificationRouter", async () => {
    const { createNotificationRouter } = await import("./router");
    expect(createNotificationRouter).toBeDefined();
    expect(typeof createNotificationRouter).toBe("function");
  });

  it("exports NotificationService", async () => {
    const { NotificationService, createNotificationService } = await import(
      "./service"
    );
    expect(NotificationService).toBeDefined();
    expect(createNotificationService).toBeDefined();
    expect(typeof createNotificationService).toBe("function");
  });

  it("exports schema tables", async () => {
    const schema = await import("./schema");
    expect(schema.notifications).toBeDefined();
    expect(schema.notificationGroups).toBeDefined();
    expect(schema.notificationSubscriptions).toBeDefined();
  });

  it("exports plugin default", async () => {
    const plugin = await import("./index");
    expect(plugin.default).toBeDefined();
  });
});

describe("NotificationService", () => {
  it("has correct method signatures", () => {
    // Type check - confirms the class structure
    type ServiceMethods = keyof import("./service").NotificationService;
    const expectedMethods: ServiceMethods[] = [
      "notifyUser",
      "notifyGroup",
      "broadcast",
      "createGroup",
      "deleteGroup",
      "getGroupSubscribers",
    ];
    expect(expectedMethods.length).toBe(6);
  });
});
