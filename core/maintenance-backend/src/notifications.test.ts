import { describe, it, expect, mock, beforeEach } from "bun:test";
import { notifyAffectedSystems } from "./notifications";
import { maintenanceCollapseKey } from "@checkstack/maintenance-common";

function createMockCatalogClient() {
  return {
    getSystemGroups: mock(() => Promise.resolve([])),
  };
}

function createMockNotificationClient() {
  return {
    notifyForSubscription: mock(() =>
      Promise.resolve({ notifiedCount: 0 }),
    ),
  };
}

function createMockLogger() {
  return {
    warn: mock(() => {}),
    error: mock(() => {}),
    info: mock(() => {}),
    debug: mock(() => {}),
  };
}

describe("notifyAffectedSystems (maintenance)", () => {
  let mockCatalogClient: ReturnType<typeof createMockCatalogClient>;
  let mockNotificationClient: ReturnType<typeof createMockNotificationClient>;
  let mockLogger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    mockCatalogClient = createMockCatalogClient();
    mockNotificationClient = createMockNotificationClient();
    mockLogger = createMockLogger();
  });

  describe("title + body", () => {
    it("titles use the maintenance name and action verb (no per-system suffix)", async () => {
      await notifyAffectedSystems({
        catalogClient: mockCatalogClient as never,
      notificationClient: mockNotificationClient as never,
        logger: mockLogger as never,
        maintenanceId: "maint-1",
        maintenanceTitle: "DB Upgrade",
        systemIds: ["sys-1"],
        action: "created",
      });

      expect(
        mockNotificationClient.notifyForSubscription,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Maintenance scheduled: DB Upgrade",
          body: expect.stringContaining(`**"DB Upgrade"**`),
        }),
      );
    });
  });

  describe("action text mapping", () => {
    it("uses 'scheduled' for created action", async () => {
      await notifyAffectedSystems({
        catalogClient: mockCatalogClient as never,
      notificationClient: mockNotificationClient as never,
        logger: mockLogger as never,
        maintenanceId: "maint-1",
        maintenanceTitle: "Test",
        systemIds: ["sys-1"],
        action: "created",
      });

      expect(
        mockNotificationClient.notifyForSubscription,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          title: expect.stringContaining("scheduled"),
        }),
      );
    });

    it("uses 'completed' for completed action", async () => {
      await notifyAffectedSystems({
        catalogClient: mockCatalogClient as never,
      notificationClient: mockNotificationClient as never,
        logger: mockLogger as never,
        maintenanceId: "maint-1",
        maintenanceTitle: "Test",
        systemIds: ["sys-1"],
        action: "completed",
      });

      expect(
        mockNotificationClient.notifyForSubscription,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          title: expect.stringContaining("completed"),
        }),
      );
    });
  });

  describe("importance", () => {
    it("always uses 'info' importance", async () => {
      await notifyAffectedSystems({
        catalogClient: mockCatalogClient as never,
      notificationClient: mockNotificationClient as never,
        logger: mockLogger as never,
        maintenanceId: "maint-1",
        maintenanceTitle: "Test",
        systemIds: ["sys-1"],
        action: "started",
      });

      expect(
        mockNotificationClient.notifyForSubscription,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          importance: "info",
        }),
      );
    });
  });

  describe("bulking + subjects + collapseKey", () => {
    it("emits a single batched call regardless of how many affected systems", async () => {
      await notifyAffectedSystems({
        catalogClient: mockCatalogClient as never,
      notificationClient: mockNotificationClient as never,
        logger: mockLogger as never,
        maintenanceId: "maint-1",
        maintenanceTitle: "Test",
        systemIds: ["sys-1", "sys-2", "sys-3"],
        action: "created",
      });

      expect(
        mockNotificationClient.notifyForSubscription,
      ).toHaveBeenCalledTimes(1);
    });

    it("uses a stable collapseKey derived from the maintenance id", async () => {
      await notifyAffectedSystems({
        catalogClient: mockCatalogClient as never,
      notificationClient: mockNotificationClient as never,
        logger: mockLogger as never,
        maintenanceId: "maint-42",
        maintenanceTitle: "Test",
        systemIds: ["sys-1"],
        action: "started",
      });

      expect(
        mockNotificationClient.notifyForSubscription,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          collapseKey: maintenanceCollapseKey("maint-42"),
        }),
      );
    });

    it("includes one subject per affected system", async () => {
      const systemNames = new Map([
        ["sys-1", "API Gateway"],
        ["sys-2", "Database"],
      ]);

      await notifyAffectedSystems({
        catalogClient: mockCatalogClient as never,
      notificationClient: mockNotificationClient as never,
        logger: mockLogger as never,
        maintenanceId: "maint-1",
        maintenanceTitle: "Test",
        systemIds: ["sys-1", "sys-2"],
        systemNames,
        action: "created",
      });

      const call = (
        mockNotificationClient.notifyForSubscription.mock
          .calls[0] as unknown as [
          { subjects?: Array<Record<string, unknown>> },
        ]
      )[0];
      expect(call?.subjects).toHaveLength(2);
      expect(call?.subjects?.[0]).toMatchObject({
        kind: "catalog.system",
        id: "sys-1",
        name: "API Gateway",
      });
    });
  });

  describe("update message in body", () => {
    it("appends the escaped update message as a blockquote", async () => {
      await notifyAffectedSystems({
        catalogClient: mockCatalogClient as never,
        notificationClient: mockNotificationClient as never,
        logger: mockLogger as never,
        maintenanceId: "maint-1",
        maintenanceTitle: "DB Upgrade",
        systemIds: ["sys-1"],
        action: "updated",
        updateMessage: "Patch applied, verifying replicas.",
      });

      const call = (
        mockNotificationClient.notifyForSubscription.mock
          .calls[0] as unknown as [{ body?: string }]
      )[0];
      expect(call?.body).toContain(
        "\n\n> Patch applied, verifying replicas",
      );
    });

    it("truncates an over-long message to a bounded length", async () => {
      const longMessage = "a".repeat(1000);
      await notifyAffectedSystems({
        catalogClient: mockCatalogClient as never,
        notificationClient: mockNotificationClient as never,
        logger: mockLogger as never,
        maintenanceId: "maint-1",
        maintenanceTitle: "DB Upgrade",
        systemIds: ["sys-1"],
        action: "updated",
        updateMessage: longMessage,
      });

      const call = (
        mockNotificationClient.notifyForSubscription.mock
          .calls[0] as unknown as [{ body?: string }]
      )[0];
      const blockquoteLine = (call?.body ?? "").split("\n\n> ")[1] ?? "";
      expect(blockquoteLine.endsWith("...")).toBe(true);
      // 500 chars + the "..." indicator.
      expect(blockquoteLine.length).toBeLessThanOrEqual(503);
    });

    it("omits the blockquote entirely when no message is provided", async () => {
      await notifyAffectedSystems({
        catalogClient: mockCatalogClient as never,
        notificationClient: mockNotificationClient as never,
        logger: mockLogger as never,
        maintenanceId: "maint-1",
        maintenanceTitle: "DB Upgrade",
        systemIds: ["sys-1"],
        action: "created",
      });

      const call = (
        mockNotificationClient.notifyForSubscription.mock
          .calls[0] as unknown as [{ body?: string }]
      )[0];
      expect(call?.body).not.toContain("\n\n>");
    });
  });

  describe("error handling", () => {
    it("logs a warning but does not throw when the notify call fails", async () => {
      mockNotificationClient.notifyForSubscription.mockRejectedValue(
        new Error("Network error"),
      );

      await notifyAffectedSystems({
        catalogClient: mockCatalogClient as never,
      notificationClient: mockNotificationClient as never,
        logger: mockLogger as never,
        maintenanceId: "maint-1",
        maintenanceTitle: "Test",
        systemIds: ["sys-1"],
        action: "created",
      });

      expect(mockLogger.warn).toHaveBeenCalled();
    });
  });
});
