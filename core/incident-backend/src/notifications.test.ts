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

  describe("update message in body", () => {
    it("appends the escaped update message as a blockquote", async () => {
      await notifyAffectedSystems({
        catalogClient: mockCatalogClient as never,
        notificationClient: mockNotificationClient as never,
        logger: mockLogger as never,
        incidentId: "inc-1",
        incidentTitle: "API Outage",
        systemIds: ["sys-1"],
        action: "updated",
        severity: "minor",
        updateMessage: "Rolled back the bad deploy, monitoring recovery.",
      });

      const call = (
        mockNotificationClient.notifyForSubscription.mock
          .calls[0] as unknown as [{ body?: string }]
      )[0];
      expect(call?.body).toContain(
        "\n\n> Rolled back the bad deploy, monitoring recovery",
      );
    });

    it("escapes markdown control characters in the message", async () => {
      await notifyAffectedSystems({
        catalogClient: mockCatalogClient as never,
        notificationClient: mockNotificationClient as never,
        logger: mockLogger as never,
        incidentId: "inc-1",
        incidentTitle: "API Outage",
        systemIds: ["sys-1"],
        action: "updated",
        severity: "minor",
        updateMessage: "See [here](http://evil) **now** `code`",
      });

      const call = (
        mockNotificationClient.notifyForSubscription.mock
          .calls[0] as unknown as [{ body?: string }]
      )[0];
      // No unescaped link/bold/code syntax survives into the body.
      expect(call?.body).not.toContain("[here](http://evil)");
      expect(call?.body).not.toContain("**now**");
      expect(call?.body).toContain("\\[here\\]");
      expect(call?.body).toContain("\\*\\*now\\*\\*");
    });

    it("strips non-whitespace control characters (ESC/NUL/BEL/DEL)", async () => {
      await notifyAffectedSystems({
        catalogClient: mockCatalogClient as never,
        notificationClient: mockNotificationClient as never,
        logger: mockLogger as never,
        incidentId: "inc-1",
        incidentTitle: "API Outage",
        systemIds: ["sys-1"],
        action: "updated",
        severity: "minor",
        updateMessage: "before\u001B\u0000\u0007\u007Fafter",
      });

      const call = (
        mockNotificationClient.notifyForSubscription.mock
          .calls[0] as unknown as [{ body?: string }]
      )[0];
      const blockquoteLine = (call?.body ?? "").split("\n\n> ")[1] ?? "";
      expect(blockquoteLine).toBe("beforeafter");
      // No control characters survive into the excerpt.
      expect(/[\u0000-\u001F\u007F-\u009F]/u.test(blockquoteLine)).toBe(
        false,
      );
    });

    it("escapes HTML-significant < and & so markup cannot be injected", async () => {
      await notifyAffectedSystems({
        catalogClient: mockCatalogClient as never,
        notificationClient: mockNotificationClient as never,
        logger: mockLogger as never,
        incidentId: "inc-1",
        incidentTitle: "API Outage",
        systemIds: ["sys-1"],
        action: "updated",
        severity: "minor",
        updateMessage: "watch <img onerror=x> & <script>",
      });

      const call = (
        mockNotificationClient.notifyForSubscription.mock
          .calls[0] as unknown as [{ body?: string }]
      )[0];
      const blockquoteLine = (call?.body ?? "").split("\n\n> ")[1] ?? "";
      expect(blockquoteLine).not.toContain("<");
      expect(blockquoteLine).toContain("&lt;img");
      expect(blockquoteLine).toContain("&amp;");
    });

    it("collapses newlines so the message cannot break out of the blockquote", async () => {
      await notifyAffectedSystems({
        catalogClient: mockCatalogClient as never,
        notificationClient: mockNotificationClient as never,
        logger: mockLogger as never,
        incidentId: "inc-1",
        incidentTitle: "API Outage",
        systemIds: ["sys-1"],
        action: "updated",
        severity: "minor",
        updateMessage: "line one\n\nline two\ninjected",
      });

      const call = (
        mockNotificationClient.notifyForSubscription.mock
          .calls[0] as unknown as [{ body?: string }]
      )[0];
      const blockquoteLine = (call?.body ?? "").split("\n\n> ")[1] ?? "";
      expect(blockquoteLine).not.toContain("\n");
      expect(blockquoteLine).toBe("line one line two injected");
    });

    it("truncates an over-long message to a bounded length", async () => {
      const longMessage = "a".repeat(1000);
      await notifyAffectedSystems({
        catalogClient: mockCatalogClient as never,
        notificationClient: mockNotificationClient as never,
        logger: mockLogger as never,
        incidentId: "inc-1",
        incidentTitle: "API Outage",
        systemIds: ["sys-1"],
        action: "updated",
        severity: "minor",
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

    it("omits the blockquote entirely for a blank/whitespace message", async () => {
      await notifyAffectedSystems({
        catalogClient: mockCatalogClient as never,
        notificationClient: mockNotificationClient as never,
        logger: mockLogger as never,
        incidentId: "inc-1",
        incidentTitle: "API Outage",
        systemIds: ["sys-1"],
        action: "updated",
        severity: "minor",
        updateMessage: "   \n  ",
      });

      const call = (
        mockNotificationClient.notifyForSubscription.mock
          .calls[0] as unknown as [{ body?: string }]
      )[0];
      expect(call?.body).not.toContain("\n\n>");
    });

    it("omits the blockquote when no message is provided", async () => {
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
