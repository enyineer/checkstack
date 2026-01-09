import { describe, it, expect, beforeEach, mock, spyOn } from "bun:test";
import {
  teamsProvider,
  TeamsConnectionSchema,
  TeamsSubscriptionSchema,
  buildAdaptiveCard,
} from "./index";

/**
 * Unit tests for the Microsoft Teams Integration Provider.
 *
 * Tests cover:
 * - Config schema validation
 * - Connection testing
 * - Team/channel options resolution
 * - Adaptive Card building
 * - Event delivery
 */

// Mock logger
const mockLogger = {
  debug: mock(() => {}),
  info: mock(() => {}),
  warn: mock(() => {}),
  error: mock(() => {}),
};

describe("Microsoft Teams Integration Provider", () => {
  beforeEach(() => {
    mockLogger.debug.mockClear();
    mockLogger.info.mockClear();
    mockLogger.warn.mockClear();
    mockLogger.error.mockClear();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Provider Metadata
  // ─────────────────────────────────────────────────────────────────────────

  describe("metadata", () => {
    it("has correct basic metadata", () => {
      expect(teamsProvider.id).toBe("teams");
      expect(teamsProvider.displayName).toBe("Microsoft Teams");
      expect(teamsProvider.description).toContain("Teams");
      expect(teamsProvider.icon).toBe("MessageSquareMore");
    });

    it("has versioned config and connection schemas", () => {
      expect(teamsProvider.config).toBeDefined();
      expect(teamsProvider.config.version).toBe(1);
      expect(teamsProvider.connectionSchema).toBeDefined();
      expect(teamsProvider.connectionSchema?.version).toBe(1);
    });

    it("has documentation", () => {
      expect(teamsProvider.documentation).toBeDefined();
      expect(teamsProvider.documentation?.setupGuide).toContain("Azure");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Config Schema Validation
  // ─────────────────────────────────────────────────────────────────────────

  describe("connection schema", () => {
    it("requires all credentials", () => {
      expect(() => {
        TeamsConnectionSchema.parse({});
      }).toThrow();

      expect(() => {
        TeamsConnectionSchema.parse({
          tenantId: "tenant-1",
          clientId: "client-1",
        });
      }).toThrow();
    });

    it("accepts valid connection config", () => {
      const result = TeamsConnectionSchema.parse({
        tenantId: "12345678-1234-1234-1234-123456789abc",
        clientId: "87654321-4321-4321-4321-cba987654321",
        clientSecret: "super-secret",
      });
      expect(result.tenantId).toBe("12345678-1234-1234-1234-123456789abc");
      expect(result.clientId).toBe("87654321-4321-4321-4321-cba987654321");
      expect(result.clientSecret).toBe("super-secret");
    });
  });

  describe("subscription schema", () => {
    it("requires all fields", () => {
      expect(() => {
        TeamsSubscriptionSchema.parse({});
      }).toThrow();

      expect(() => {
        TeamsSubscriptionSchema.parse({ connectionId: "conn-1" });
      }).toThrow();

      expect(() => {
        TeamsSubscriptionSchema.parse({
          connectionId: "conn-1",
          teamId: "team-1",
        });
      }).toThrow();
    });

    it("accepts valid subscription config", () => {
      const result = TeamsSubscriptionSchema.parse({
        connectionId: "conn-1",
        teamId: "team-123",
        channelId: "channel-456",
      });
      expect(result.connectionId).toBe("conn-1");
      expect(result.teamId).toBe("team-123");
      expect(result.channelId).toBe("channel-456");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Adaptive Card Building
  // ─────────────────────────────────────────────────────────────────────────

  describe("adaptive card builder", () => {
    it("builds card with event details", () => {
      const card = buildAdaptiveCard({
        eventId: "incident.created",
        payload: { incidentId: "inc-123", severity: "critical" },
        subscriptionName: "Critical Incidents",
        timestamp: "2024-01-15T10:30:00Z",
      }) as Record<string, unknown>;

      expect(card.type).toBe("AdaptiveCard");
      expect(card.version).toBe("1.4");

      const body = card.body as Array<Record<string, unknown>>;
      expect(body.length).toBeGreaterThan(0);

      // Check for event info in FactSet
      const factSet = body.find((b) => b.type === "FactSet") as Record<
        string,
        unknown
      >;
      expect(factSet).toBeDefined();

      const facts = factSet.facts as Array<{ title: string; value: string }>;
      expect(facts.some((f) => f.value === "incident.created")).toBe(true);
      expect(facts.some((f) => f.value === "Critical Incidents")).toBe(true);
    });

    it("includes JSON payload in code block", () => {
      const card = buildAdaptiveCard({
        eventId: "test.event",
        payload: { key: "value" },
        subscriptionName: "Test",
        timestamp: new Date().toISOString(),
      }) as Record<string, unknown>;

      const body = card.body as Array<Record<string, unknown>>;
      const codeBlock = body.find((b) => b.fontType === "monospace") as Record<
        string,
        unknown
      >;

      expect(codeBlock).toBeDefined();
      expect(codeBlock.text).toContain('"key"');
      expect(codeBlock.text).toContain('"value"');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test Connection
  // ─────────────────────────────────────────────────────────────────────────

  describe("testConnection", () => {
    it("returns success when Graph API is accessible", async () => {
      let requestCount = 0;
      const mockFetch = spyOn(globalThis, "fetch").mockImplementation((async (
        url: RequestInfo | URL
      ) => {
        requestCount++;
        const urlStr = url.toString();

        // Token request
        if (urlStr.includes("oauth2/v2.0/token")) {
          return new Response(
            JSON.stringify({ access_token: "test-token", expires_in: 3600 }),
            { status: 200 }
          );
        }

        // Teams list request
        if (urlStr.includes("/teams")) {
          return new Response(
            JSON.stringify({
              value: [
                { id: "team-1", displayName: "Engineering" },
                { id: "team-2", displayName: "DevOps" },
              ],
            }),
            { status: 200 }
          );
        }

        return new Response("Not Found", { status: 404 });
      }) as unknown as typeof fetch);

      try {
        const result = await teamsProvider.testConnection!({
          tenantId: "tenant-123",
          clientId: "client-123",
          clientSecret: "secret-123",
        });

        expect(result.success).toBe(true);
        expect(result.message).toContain("2 team(s)");
      } finally {
        mockFetch.mockRestore();
      }
    });

    it("returns failure for auth errors", async () => {
      const mockFetch = spyOn(globalThis, "fetch").mockImplementation(
        (async () => {
          return new Response("Unauthorized", { status: 401 });
        }) as unknown as typeof fetch
      );

      try {
        const result = await teamsProvider.testConnection!({
          tenantId: "tenant-123",
          clientId: "client-123",
          clientSecret: "wrong-secret",
        });

        expect(result.success).toBe(false);
        expect(result.message).toContain("failed");
      } finally {
        mockFetch.mockRestore();
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Get Connection Options
  // ─────────────────────────────────────────────────────────────────────────

  describe("getConnectionOptions", () => {
    it("returns team options", async () => {
      const mockFetch = spyOn(globalThis, "fetch").mockImplementation((async (
        url: RequestInfo | URL
      ) => {
        const urlStr = url.toString();

        if (urlStr.includes("oauth2/v2.0/token")) {
          return new Response(
            JSON.stringify({ access_token: "test-token", expires_in: 3600 }),
            { status: 200 }
          );
        }

        if (urlStr.includes("/teams") && !urlStr.includes("/channels")) {
          return new Response(
            JSON.stringify({
              value: [
                { id: "team-1", displayName: "Engineering" },
                { id: "team-2", displayName: "DevOps" },
              ],
            }),
            { status: 200 }
          );
        }

        return new Response("Not Found", { status: 404 });
      }) as unknown as typeof fetch);

      try {
        const options = await teamsProvider.getConnectionOptions!({
          resolverName: "teamOptions",
          connectionId: "conn-1",
          context: {},
          logger: mockLogger,
          getConnectionWithCredentials: async () => ({
            config: {
              tenantId: "t",
              clientId: "c",
              clientSecret: "s",
            },
          }),
        });

        expect(options).toHaveLength(2);
        expect(options[0]).toEqual({ value: "team-1", label: "Engineering" });
        expect(options[1]).toEqual({ value: "team-2", label: "DevOps" });
      } finally {
        mockFetch.mockRestore();
      }
    });

    it("returns channel options when teamId is provided", async () => {
      const mockFetch = spyOn(globalThis, "fetch").mockImplementation((async (
        url: RequestInfo | URL
      ) => {
        const urlStr = url.toString();

        if (urlStr.includes("oauth2/v2.0/token")) {
          return new Response(
            JSON.stringify({ access_token: "test-token", expires_in: 3600 }),
            { status: 200 }
          );
        }

        if (urlStr.includes("/channels")) {
          return new Response(
            JSON.stringify({
              value: [
                { id: "ch-1", displayName: "General" },
                { id: "ch-2", displayName: "Alerts" },
              ],
            }),
            { status: 200 }
          );
        }

        return new Response("Not Found", { status: 404 });
      }) as unknown as typeof fetch);

      try {
        const options = await teamsProvider.getConnectionOptions!({
          resolverName: "channelOptions",
          connectionId: "conn-1",
          context: { teamId: "team-1" },
          logger: mockLogger,
          getConnectionWithCredentials: async () => ({
            config: {
              tenantId: "t",
              clientId: "c",
              clientSecret: "s",
            },
          }),
        });

        expect(options).toHaveLength(2);
        expect(options[0]).toEqual({ value: "ch-1", label: "General" });
        expect(options[1]).toEqual({ value: "ch-2", label: "Alerts" });
      } finally {
        mockFetch.mockRestore();
      }
    });

    it("returns empty array when teamId is missing for channel options", async () => {
      const mockFetch = spyOn(globalThis, "fetch").mockImplementation((async (
        url: RequestInfo | URL
      ) => {
        const urlStr = url.toString();
        if (urlStr.includes("oauth2/v2.0/token")) {
          return new Response(
            JSON.stringify({ access_token: "test-token", expires_in: 3600 }),
            { status: 200 }
          );
        }
        return new Response("Not Found", { status: 404 });
      }) as unknown as typeof fetch);

      try {
        const options = await teamsProvider.getConnectionOptions!({
          resolverName: "channelOptions",
          connectionId: "conn-1",
          context: {}, // No teamId
          logger: mockLogger,
          getConnectionWithCredentials: async () => ({
            config: {
              tenantId: "t",
              clientId: "c",
              clientSecret: "s",
            },
          }),
        });

        expect(options).toEqual([]);
      } finally {
        mockFetch.mockRestore();
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Delivery
  // ─────────────────────────────────────────────────────────────────────────

  describe("deliver", () => {
    it("sends message to Teams channel successfully", async () => {
      let capturedMessageUrl: string | undefined;
      let capturedBody: string | undefined;

      const mockFetch = spyOn(globalThis, "fetch").mockImplementation((async (
        url: RequestInfo | URL,
        options?: RequestInit
      ) => {
        const urlStr = url.toString();

        if (urlStr.includes("oauth2/v2.0/token")) {
          return new Response(
            JSON.stringify({ access_token: "test-token", expires_in: 3600 }),
            { status: 200 }
          );
        }

        if (urlStr.includes("/messages")) {
          capturedMessageUrl = urlStr;
          capturedBody = options?.body as string;
          return new Response(JSON.stringify({ id: "msg-123" }), {
            status: 200,
          });
        }

        return new Response("Not Found", { status: 404 });
      }) as unknown as typeof fetch);

      try {
        const result = await teamsProvider.deliver({
          event: {
            eventId: "incident.created",
            payload: { incidentId: "inc-123" },
            timestamp: new Date().toISOString(),
            deliveryId: "del-789",
          },
          subscription: {
            id: "sub-1",
            name: "Incident Alerts",
          },
          providerConfig: {
            connectionId: "conn-1",
            teamId: "team-abc",
            channelId: "channel-xyz",
          },
          logger: mockLogger,
          getConnectionWithCredentials: async () => ({
            id: "conn-1",
            config: {
              tenantId: "t",
              clientId: "c",
              clientSecret: "s",
            },
          }),
        });

        expect(result.success).toBe(true);
        expect(result.externalId).toBe("msg-123");
        expect(capturedMessageUrl).toContain("team-abc");
        expect(capturedMessageUrl).toContain("channel-xyz");

        const parsedBody = JSON.parse(capturedBody!);
        expect(parsedBody.attachments).toHaveLength(1);
        expect(parsedBody.attachments[0].contentType).toBe(
          "application/vnd.microsoft.card.adaptive"
        );
      } finally {
        mockFetch.mockRestore();
      }
    });

    it("returns error when connection not found", async () => {
      const result = await teamsProvider.deliver({
        event: {
          eventId: "test.event",
          payload: {},
          timestamp: new Date().toISOString(),
          deliveryId: "del-1",
        },
        subscription: { id: "sub-1", name: "Test" },
        providerConfig: {
          connectionId: "nonexistent",
          teamId: "team-1",
          channelId: "ch-1",
        },
        logger: mockLogger,
        getConnectionWithCredentials: async () => undefined,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });
  });
});
