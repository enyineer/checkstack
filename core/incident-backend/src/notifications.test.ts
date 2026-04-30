import { describe, it, expect, mock, beforeEach } from "bun:test";
import { notifyAffectedSystems } from "./notifications";
import { incidentCollapseKey } from "@checkstack/incident-common";

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

describe("notifyAffectedSystems", () => {
  let mockCatalogClient: ReturnType<typeof createMockCatalogClient>;
  let mockNotificationClient: ReturnType<typeof createMockNotificationClient>;
  let mockLogger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    mockCatalogClient = createMockCatalogClient();
    mockNotificationClient = createMockNotificationClient();
    mockLogger = createMockLogger();
  });

  describe("importance logic", () => {
    it("should use 'info' importance for resolved action regardless of severity", async () => {
      await notifyAffectedSystems({
        catalogClient: mockCatalogClient as never,
      notificationClient: mockNotificationClient as never,
        logger: mockLogger as never,
        incidentId: "inc-1",
        incidentTitle: "Test Incident",
        systemIds: ["sys-1"],
        action: "resolved",
        severity: "critical",
      });

      expect(
        mockNotificationClient.notifyForSubscription,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          importance: "info",
        }),
      );
    });

    it("should use 'critical' importance for reopened action with critical severity", async () => {
      await notifyAffectedSystems({
        catalogClient: mockCatalogClient as never,
      notificationClient: mockNotificationClient as never,
        logger: mockLogger as never,
        incidentId: "inc-1",
        incidentTitle: "Test Incident",
        systemIds: ["sys-1"],
        action: "reopened",
        severity: "critical",
      });

      expect(
        mockNotificationClient.notifyForSubscription,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          importance: "critical",
        }),
      );
    });

    it("should use 'warning' importance for created action with major severity", async () => {
      await notifyAffectedSystems({
        catalogClient: mockCatalogClient as never,
      notificationClient: mockNotificationClient as never,
        logger: mockLogger as never,
        incidentId: "inc-1",
        incidentTitle: "Test Incident",
        systemIds: ["sys-1"],
        action: "created",
        severity: "major",
      });

      expect(
        mockNotificationClient.notifyForSubscription,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          importance: "warning",
        }),
      );
    });

    it("should use 'info' importance for updated action with minor severity", async () => {
      await notifyAffectedSystems({
        catalogClient: mockCatalogClient as never,
      notificationClient: mockNotificationClient as never,
        logger: mockLogger as never,
        incidentId: "inc-1",
        incidentTitle: "Test Incident",
        systemIds: ["sys-1"],
        action: "updated",
        severity: "minor",
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

  describe("action text", () => {
    it("titles use the incident name and action verb (no per-system suffix)", async () => {
      await notifyAffectedSystems({
        catalogClient: mockCatalogClient as never,
      notificationClient: mockNotificationClient as never,
        logger: mockLogger as never,
        incidentId: "inc-1",
        incidentTitle: "API Outage",
        systemIds: ["sys-1"],
        action: "created",
        severity: "minor",
      });

      expect(
        mockNotificationClient.notifyForSubscription,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Incident reported: API Outage",
          body: expect.stringContaining("reported"),
        }),
      );
    });

    it("uses 'reopened' verb on reopen", async () => {
      await notifyAffectedSystems({
        catalogClient: mockCatalogClient as never,
      notificationClient: mockNotificationClient as never,
        logger: mockLogger as never,
        incidentId: "inc-1",
        incidentTitle: "API Outage",
        systemIds: ["sys-1"],
        action: "reopened",
        severity: "minor",
      });

      expect(
        mockNotificationClient.notifyForSubscription,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Incident reopened: API Outage",
        }),
      );
    });
  });

  describe("bulking", () => {
    it("emits a single batched call regardless of how many affected systems", async () => {
      await notifyAffectedSystems({
        catalogClient: mockCatalogClient as never,
      notificationClient: mockNotificationClient as never,
        logger: mockLogger as never,
        incidentId: "inc-1",
        incidentTitle: "Test Incident",
        systemIds: ["sys-1", "sys-2", "sys-3"],
        action: "created",
        severity: "minor",
      });

      expect(
        mockNotificationClient.notifyForSubscription,
      ).toHaveBeenCalledTimes(1);
      expect(
        mockNotificationClient.notifyForSubscription,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          resourceKeys: ["sys-1", "sys-2", "sys-3"],
        }),
      );
    });

    it("deduplicates repeated system ids in the input list", async () => {
      await notifyAffectedSystems({
        catalogClient: mockCatalogClient as never,
      notificationClient: mockNotificationClient as never,
        logger: mockLogger as never,
        incidentId: "inc-1",
        incidentTitle: "Test Incident",
        systemIds: ["sys-1", "sys-1", "sys-2", "sys-2", "sys-1"],
        action: "created",
        severity: "minor",
      });

      expect(
        mockNotificationClient.notifyForSubscription,
      ).toHaveBeenCalledTimes(1);
      expect(
        mockNotificationClient.notifyForSubscription,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          resourceKeys: ["sys-1", "sys-2"],
        }),
      );
    });

    it("skips the call when there are no affected systems", async () => {
      await notifyAffectedSystems({
        catalogClient: mockCatalogClient as never,
      notificationClient: mockNotificationClient as never,
        logger: mockLogger as never,
        incidentId: "inc-1",
        incidentTitle: "Test Incident",
        systemIds: [],
        action: "created",
        severity: "minor",
      });

      expect(
        mockNotificationClient.notifyForSubscription,
      ).not.toHaveBeenCalled();
    });
  });

  describe("subjects + collapseKey", () => {
    it("includes one subject per affected system with name + url", async () => {
      const systemNames = new Map([
        ["sys-1", "Production Database"],
        ["sys-2", "Cache Layer"],
      ]);

      await notifyAffectedSystems({
        catalogClient: mockCatalogClient as never,
      notificationClient: mockNotificationClient as never,
        logger: mockLogger as never,
        incidentId: "inc-1",
        incidentTitle: "DB Outage",
        systemIds: ["sys-1", "sys-2"],
        systemNames,
        action: "created",
        severity: "critical",
      });

      const call = (
        mockNotificationClient.notifyForSubscription.mock
          .calls[0] as unknown as [
          { subjects?: Array<Record<string, unknown>> },
        ]
      )[0];
      expect(call?.subjects).toEqual([
        expect.objectContaining({
          kind: "catalog.system", // produced by createSystemSubject
          id: "sys-1",
          name: "Production Database",
          url: expect.stringContaining("sys-1"),
        }),
        expect.objectContaining({
          kind: "catalog.system", // produced by createSystemSubject
          id: "sys-2",
          name: "Cache Layer",
        }),
      ]);
    });

    it("falls back to systemId for the subject name when no map is provided", async () => {
      await notifyAffectedSystems({
        catalogClient: mockCatalogClient as never,
      notificationClient: mockNotificationClient as never,
        logger: mockLogger as never,
        incidentId: "inc-1",
        incidentTitle: "Test Incident",
        systemIds: ["sys-1"],
        action: "resolved",
        severity: "minor",
      });

      const call = (
        mockNotificationClient.notifyForSubscription.mock
          .calls[0] as unknown as [
          { subjects?: Array<Record<string, unknown>> },
        ]
      )[0];
      expect(call?.subjects?.[0]?.name).toBe("sys-1");
    });

    it("uses a stable collapseKey derived from the incident id", async () => {
      await notifyAffectedSystems({
        catalogClient: mockCatalogClient as never,
      notificationClient: mockNotificationClient as never,
        logger: mockLogger as never,
        incidentId: "inc-42",
        incidentTitle: "Test Incident",
        systemIds: ["sys-1"],
        action: "created",
        severity: "minor",
      });

      expect(
        mockNotificationClient.notifyForSubscription,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          collapseKey: incidentCollapseKey("inc-42"),
        }),
      );
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
        incidentId: "inc-1",
        incidentTitle: "Test Incident",
        systemIds: ["sys-1"],
        action: "created",
        severity: "minor",
      });

      expect(mockLogger.warn).toHaveBeenCalled();
    });
  });
});
