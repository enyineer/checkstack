import { describe, it, expect, mock, beforeEach } from "bun:test";
import { notifyAffectedSystems } from "./notifications";

// Mock catalog client
function createMockCatalogClient() {
  return {
    notifySystemSubscribers: mock(() => Promise.resolve()),
  };
}

// Mock logger
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
  let mockLogger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    mockCatalogClient = createMockCatalogClient();
    mockLogger = createMockLogger();
  });

  describe("importance logic", () => {
    it("should use 'info' importance for resolved action regardless of severity", async () => {
      await notifyAffectedSystems({
        catalogClient: mockCatalogClient as never,
        logger: mockLogger as never,
        incidentId: "inc-1",
        incidentTitle: "Test Incident",
        systemIds: ["sys-1"],
        action: "resolved",
        severity: "critical", // Even critical severity should be info when resolved
      });

      expect(mockCatalogClient.notifySystemSubscribers).toHaveBeenCalledWith(
        expect.objectContaining({
          importance: "info",
        }),
      );
    });

    it("should use 'critical' importance for reopened action with critical severity", async () => {
      await notifyAffectedSystems({
        catalogClient: mockCatalogClient as never,
        logger: mockLogger as never,
        incidentId: "inc-1",
        incidentTitle: "Test Incident",
        systemIds: ["sys-1"],
        action: "reopened",
        severity: "critical",
      });

      expect(mockCatalogClient.notifySystemSubscribers).toHaveBeenCalledWith(
        expect.objectContaining({
          importance: "critical",
        }),
      );
    });

    it("should use 'warning' importance for created action with major severity", async () => {
      await notifyAffectedSystems({
        catalogClient: mockCatalogClient as never,
        logger: mockLogger as never,
        incidentId: "inc-1",
        incidentTitle: "Test Incident",
        systemIds: ["sys-1"],
        action: "created",
        severity: "major",
      });

      expect(mockCatalogClient.notifySystemSubscribers).toHaveBeenCalledWith(
        expect.objectContaining({
          importance: "warning",
        }),
      );
    });

    it("should use 'info' importance for updated action with minor severity", async () => {
      await notifyAffectedSystems({
        catalogClient: mockCatalogClient as never,
        logger: mockLogger as never,
        incidentId: "inc-1",
        incidentTitle: "Test Incident",
        systemIds: ["sys-1"],
        action: "updated",
        severity: "minor",
      });

      expect(mockCatalogClient.notifySystemSubscribers).toHaveBeenCalledWith(
        expect.objectContaining({
          importance: "info",
        }),
      );
    });
  });

  describe("action text", () => {
    it("should use 'reported' for created action", async () => {
      await notifyAffectedSystems({
        catalogClient: mockCatalogClient as never,
        logger: mockLogger as never,
        incidentId: "inc-1",
        incidentTitle: "Test Incident",
        systemIds: ["sys-1"],
        action: "created",
        severity: "minor",
      });

      expect(mockCatalogClient.notifySystemSubscribers).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Incident reported",
          body: expect.stringContaining("reported"),
        }),
      );
    });

    it("should use 'reopened' for reopened action", async () => {
      await notifyAffectedSystems({
        catalogClient: mockCatalogClient as never,
        logger: mockLogger as never,
        incidentId: "inc-1",
        incidentTitle: "Test Incident",
        systemIds: ["sys-1"],
        action: "reopened",
        severity: "minor",
      });

      expect(mockCatalogClient.notifySystemSubscribers).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Incident reopened",
          body: expect.stringContaining("reopened"),
        }),
      );
    });
  });

  describe("system deduplication", () => {
    it("should deduplicate system IDs", async () => {
      await notifyAffectedSystems({
        catalogClient: mockCatalogClient as never,
        logger: mockLogger as never,
        incidentId: "inc-1",
        incidentTitle: "Test Incident",
        systemIds: ["sys-1", "sys-1", "sys-2", "sys-2", "sys-1"],
        action: "created",
        severity: "minor",
      });

      // Should only be called twice (for sys-1 and sys-2)
      expect(mockCatalogClient.notifySystemSubscribers).toHaveBeenCalledTimes(
        2,
      );
    });
  });

  describe("error handling", () => {
    it("should log warning but not throw when notification fails", async () => {
      mockCatalogClient.notifySystemSubscribers.mockRejectedValue(
        new Error("Network error"),
      );

      // Should not throw
      await notifyAffectedSystems({
        catalogClient: mockCatalogClient as never,
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
