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

describe("notifyAffectedSystems (maintenance)", () => {
  let mockCatalogClient: ReturnType<typeof createMockCatalogClient>;
  let mockLogger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    mockCatalogClient = createMockCatalogClient();
    mockLogger = createMockLogger();
  });

  describe("system name inclusion", () => {
    it("should include system name in title when systemNames map is provided", async () => {
      const systemNames = new Map([
        ["sys-1", "Production Database"],
      ]);

      await notifyAffectedSystems({
        catalogClient: mockCatalogClient as never,
        logger: mockLogger as never,
        maintenanceId: "maint-1",
        maintenanceTitle: "Scheduled DB Upgrade",
        systemIds: ["sys-1"],
        systemNames,
        action: "created",
      });

      expect(mockCatalogClient.notifySystemSubscribers).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Maintenance scheduled: Production Database",
          body: expect.stringContaining("**Production Database**"),
        }),
      );
    });

    it("should fall back to systemId when systemNames map is not provided", async () => {
      await notifyAffectedSystems({
        catalogClient: mockCatalogClient as never,
        logger: mockLogger as never,
        maintenanceId: "maint-1",
        maintenanceTitle: "Scheduled DB Upgrade",
        systemIds: ["sys-1"],
        action: "started",
      });

      expect(mockCatalogClient.notifySystemSubscribers).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Maintenance started: sys-1",
          body: expect.stringContaining("**sys-1**"),
        }),
      );
    });
  });

  describe("action text mapping", () => {
    it("should use 'scheduled' for created action", async () => {
      await notifyAffectedSystems({
        catalogClient: mockCatalogClient as never,
        logger: mockLogger as never,
        maintenanceId: "maint-1",
        maintenanceTitle: "Test",
        systemIds: ["sys-1"],
        action: "created",
      });

      expect(mockCatalogClient.notifySystemSubscribers).toHaveBeenCalledWith(
        expect.objectContaining({
          title: expect.stringContaining("scheduled"),
        }),
      );
    });

    it("should use 'completed' for completed action", async () => {
      await notifyAffectedSystems({
        catalogClient: mockCatalogClient as never,
        logger: mockLogger as never,
        maintenanceId: "maint-1",
        maintenanceTitle: "Test",
        systemIds: ["sys-1"],
        action: "completed",
      });

      expect(mockCatalogClient.notifySystemSubscribers).toHaveBeenCalledWith(
        expect.objectContaining({
          title: expect.stringContaining("completed"),
        }),
      );
    });
  });

  describe("importance", () => {
    it("should always use 'info' importance", async () => {
      await notifyAffectedSystems({
        catalogClient: mockCatalogClient as never,
        logger: mockLogger as never,
        maintenanceId: "maint-1",
        maintenanceTitle: "Test",
        systemIds: ["sys-1"],
        action: "started",
      });

      expect(mockCatalogClient.notifySystemSubscribers).toHaveBeenCalledWith(
        expect.objectContaining({
          importance: "info",
        }),
      );
    });
  });

  describe("error handling", () => {
    it("should log warning but not throw when notification fails", async () => {
      mockCatalogClient.notifySystemSubscribers.mockRejectedValue(
        new Error("Network error"),
      );

      await notifyAffectedSystems({
        catalogClient: mockCatalogClient as never,
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
