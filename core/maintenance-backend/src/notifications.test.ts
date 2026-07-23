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
    const bodyOf = () =>
      (
        mockNotificationClient.notifyForSubscription.mock
          .calls[0] as unknown as [{ body?: string }]
      )[0]?.body ?? "";

    it("appends the update message as its own markdown block", async () => {
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

      expect(bodyOf()).toContain("\n\nPatch applied, verifying replicas.");
    });

    it("PRESERVES authored markdown so a link renders (the reported bug)", async () => {
      await notifyAffectedSystems({
        catalogClient: mockCatalogClient as never,
        notificationClient: mockNotificationClient as never,
        logger: mockLogger as never,
        maintenanceId: "maint-1",
        maintenanceTitle: "DB Upgrade",
        systemIds: ["sys-1"],
        action: "updated",
        updateMessage: "See [the details](https://example.com/m/1) here",
      });

      const body = bodyOf();
      expect(body).toContain("[the details](https://example.com/m/1)");
      expect(body).not.toContain("\\[the details\\]");
    });

    it("truncates an over-long message to a bounded length", async () => {
      await notifyAffectedSystems({
        catalogClient: mockCatalogClient as never,
        notificationClient: mockNotificationClient as never,
        logger: mockLogger as never,
        maintenanceId: "maint-1",
        maintenanceTitle: "DB Upgrade",
        systemIds: ["sys-1"],
        action: "updated",
        updateMessage: "a".repeat(1000),
      });

      const block = bodyOf().split("\n\n").at(-1) ?? "";
      expect(block.endsWith("...")).toBe(true);
      expect(block.length).toBeLessThanOrEqual(503);
    });

    it("appends nothing when no message is provided", async () => {
      await notifyAffectedSystems({
        catalogClient: mockCatalogClient as never,
        notificationClient: mockNotificationClient as never,
        logger: mockLogger as never,
        maintenanceId: "maint-1",
        maintenanceTitle: "DB Upgrade",
        systemIds: ["sys-1"],
        action: "created",
      });

      expect(bodyOf().includes("\n\n")).toBe(false);
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
