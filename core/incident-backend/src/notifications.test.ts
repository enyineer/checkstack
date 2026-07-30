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
        incidentId: "inc-1",
        incidentTitle: "API Outage",
        systemIds: ["sys-1"],
        action: "updated",
        severity: "minor",
        updateMessage: "Rolled back the bad deploy, monitoring recovery.",
      });

      expect(bodyOf()).toContain(
        "\n\nRolled back the bad deploy, monitoring recovery.",
      );
    });

    it("PRESERVES authored markdown so a link renders (the reported bug)", async () => {
      await notifyAffectedSystems({
        catalogClient: mockCatalogClient as never,
        notificationClient: mockNotificationClient as never,
        logger: mockLogger as never,
        incidentId: "inc-1",
        incidentTitle: "API Outage",
        systemIds: ["sys-1"],
        action: "updated",
        severity: "minor",
        updateMessage: "See [the status page](https://example.com/s/1) **now**",
      });

      const body = bodyOf();
      expect(body).toContain("[the status page](https://example.com/s/1)");
      expect(body).toContain("**now**");
      expect(body).not.toContain("\\[the status page\\]");
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

      const body = bodyOf();
      expect(body).toContain("\n\nbeforeafter");
      expect(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/u.test(body.split("\n\n").at(-1) ?? "")).toBe(false);
    });

    it("preserves multi-line structure instead of collapsing to one line", async () => {
      await notifyAffectedSystems({
        catalogClient: mockCatalogClient as never,
        notificationClient: mockNotificationClient as never,
        logger: mockLogger as never,
        incidentId: "inc-1",
        incidentTitle: "API Outage",
        systemIds: ["sys-1"],
        action: "updated",
        severity: "minor",
        updateMessage: "- rolled back\n- monitoring",
      });

      expect(bodyOf()).toContain("\n\n- rolled back\n- monitoring");
    });

    it("truncates an over-long message to a bounded length", async () => {
      await notifyAffectedSystems({
        catalogClient: mockCatalogClient as never,
        notificationClient: mockNotificationClient as never,
        logger: mockLogger as never,
        incidentId: "inc-1",
        incidentTitle: "API Outage",
        systemIds: ["sys-1"],
        action: "updated",
        severity: "minor",
        updateMessage: "a".repeat(1000),
      });

      const block = bodyOf().split("\n\n").at(-1) ?? "";
      expect(block.endsWith("...")).toBe(true);
      expect(block.length).toBeLessThanOrEqual(503);
    });

    it("appends no extra block for a blank/whitespace message", async () => {
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

      // No suffix -> the body is a single paragraph with no block separator.
      expect(bodyOf().includes("\n\n")).toBe(false);
    });

    it("appends nothing when no message is provided", async () => {
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

/**
 * The REAL notification body build, not just the converter.
 *
 * `update-message.test.ts` proves the sanitizer strips the mention scheme and
 * `mention-leak.test.ts` proves each channel converter is faithful. Neither
 * proves that THIS function actually routes the update message through the
 * sanitizer - a caller that interpolated `updateMessage` directly would pass
 * both of those suites and still ship the internal URI to every subscriber.
 */
describe("notifyAffectedSystems does not leak the mention scheme", () => {
  const bodyOf = (client: ReturnType<typeof createMockNotificationClient>) => {
    const payload = (
      client.notifyForSubscription.mock.calls[0] as unknown[] | undefined
    )?.[0] as { body?: string } | undefined;
    return payload?.body ?? "";
  };

  it("flattens a mention in the update message to its label", async () => {
    const mockCatalog = createMockCatalogClient();
    const mockNotify = createMockNotificationClient();
    const logger = createMockLogger();

    await notifyAffectedSystems({
      catalogClient: mockCatalog as never,
      notificationClient: mockNotify as never,
      logger: logger as never,
      incidentId: "inc-1",
      incidentTitle: "Checkout errors",
      systemIds: ["sys-1"],
      action: "updated",
      severity: "major",
      updateMessage:
        "Rolled back. See [Database upgrade](checkstack:maintenance/9f1c-abc).",
    });

    const body = bodyOf(mockNotify);
    expect(body).not.toContain("checkstack:");
    expect(body).toContain("Database upgrade");
  });

  it("keeps an ordinary link in the update message intact", async () => {
    const mockCatalog = createMockCatalogClient();
    const mockNotify = createMockNotificationClient();
    const logger = createMockLogger();

    await notifyAffectedSystems({
      catalogClient: mockCatalog as never,
      notificationClient: mockNotify as never,
      logger: logger as never,
      incidentId: "inc-1",
      incidentTitle: "Checkout errors",
      systemIds: ["sys-1"],
      action: "updated",
      severity: "major",
      updateMessage: "See [the runbook](https://example.com/rb).",
    });

    expect(bodyOf(mockNotify)).toContain("https://example.com/rb");
  });
});
