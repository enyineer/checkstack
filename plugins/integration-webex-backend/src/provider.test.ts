import { describe, it, expect, beforeEach, mock, spyOn } from "bun:test";
import {
  webexProvider,
  WebexConnectionSchema,
  WebexSubscriptionSchema,
} from "./index";

/**
 * Unit tests for the Webex Integration Provider.
 *
 * Tests cover:
 * - Config schema validation
 * - Connection testing
 * - Room options resolution
 * - Event delivery
 */

// Mock logger
const mockLogger = {
  debug: mock(() => {}),
  info: mock(() => {}),
  warn: mock(() => {}),
  error: mock(() => {}),
};

describe("Webex Integration Provider", () => {
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
      expect(webexProvider.id).toBe("webex");
      expect(webexProvider.displayName).toBe("Webex");
      expect(webexProvider.description).toContain("Webex");
      expect(webexProvider.icon).toBe("MessageSquare");
    });

    it("has versioned config and connection schemas", () => {
      expect(webexProvider.config).toBeDefined();
      expect(webexProvider.config.version).toBe(1);
      expect(webexProvider.connectionSchema).toBeDefined();
      expect(webexProvider.connectionSchema?.version).toBe(1);
    });

    it("has documentation", () => {
      expect(webexProvider.documentation).toBeDefined();
      expect(webexProvider.documentation?.setupGuide).toContain("Webex Bot");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Config Schema Validation
  // ─────────────────────────────────────────────────────────────────────────

  describe("connection schema", () => {
    it("requires bot token", () => {
      expect(() => {
        WebexConnectionSchema.parse({});
      }).toThrow();
    });

    it("accepts valid connection config", () => {
      const result = WebexConnectionSchema.parse({
        botToken: "test-bot-token-abc123",
      });
      expect(result.botToken).toBe("test-bot-token-abc123");
    });
  });

  describe("subscription schema", () => {
    it("requires connectionId and roomId", () => {
      expect(() => {
        WebexSubscriptionSchema.parse({});
      }).toThrow();

      expect(() => {
        WebexSubscriptionSchema.parse({ connectionId: "conn-1" });
      }).toThrow();
    });

    it("accepts valid subscription config", () => {
      const result = WebexSubscriptionSchema.parse({
        connectionId: "conn-1",
        roomId: "room-123",
      });
      expect(result.connectionId).toBe("conn-1");
      expect(result.roomId).toBe("room-123");
      expect(result.messageTemplate).toBeUndefined();
    });

    it("accepts optional message template", () => {
      const result = WebexSubscriptionSchema.parse({
        connectionId: "conn-1",
        roomId: "room-123",
        messageTemplate: "Event: {{event.eventId}}",
      });
      expect(result.messageTemplate).toBe("Event: {{event.eventId}}");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test Connection
  // ─────────────────────────────────────────────────────────────────────────

  describe("testConnection", () => {
    it("returns success for valid token", async () => {
      const mockFetch = spyOn(globalThis, "fetch").mockImplementation(
        (async () => {
          return new Response(
            JSON.stringify({ id: "bot-123", displayName: "Test Bot" }),
            { status: 200 }
          );
        }) as unknown as typeof fetch
      );

      try {
        const result = await webexProvider.testConnection!({
          botToken: "valid-token",
        });

        expect(result.success).toBe(true);
        expect(result.message).toContain("Test Bot");
      } finally {
        mockFetch.mockRestore();
      }
    });

    it("returns failure for invalid token", async () => {
      const mockFetch = spyOn(globalThis, "fetch").mockImplementation(
        (async () => {
          return new Response("Unauthorized", { status: 401 });
        }) as unknown as typeof fetch
      );

      try {
        const result = await webexProvider.testConnection!({
          botToken: "invalid-token",
        });

        expect(result.success).toBe(false);
        expect(result.message).toContain("failed");
      } finally {
        mockFetch.mockRestore();
      }
    });

    it("returns failure for invalid config", async () => {
      // Pass config with empty botToken - passes validation but fails API call
      const result = await webexProvider.testConnection!({
        botToken: "",
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain("failed");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Get Connection Options
  // ─────────────────────────────────────────────────────────────────────────

  describe("getConnectionOptions", () => {
    it("returns room options when resolver matches", async () => {
      const mockFetch = spyOn(globalThis, "fetch").mockImplementation(
        (async () => {
          return new Response(
            JSON.stringify({
              items: [
                { id: "room-1", title: "Engineering", type: "group" },
                { id: "room-2", title: "DevOps", type: "group" },
              ],
            }),
            { status: 200 }
          );
        }) as unknown as typeof fetch
      );

      try {
        const options = await webexProvider.getConnectionOptions!({
          resolverName: "roomOptions",
          connectionId: "conn-1",
          context: {},
          logger: mockLogger,
          getConnectionWithCredentials: async () => ({
            config: { botToken: "test-token" },
          }),
        });

        expect(options).toHaveLength(2);
        expect(options[0]).toEqual({ value: "room-1", label: "Engineering" });
        expect(options[1]).toEqual({ value: "room-2", label: "DevOps" });
      } finally {
        mockFetch.mockRestore();
      }
    });

    it("returns empty array for unknown resolver", async () => {
      const options = await webexProvider.getConnectionOptions!({
        resolverName: "unknownResolver",
        connectionId: "conn-1",
        context: {},
        logger: mockLogger,
        getConnectionWithCredentials: async () => ({
          config: { botToken: "test-token" },
        }),
      });

      expect(options).toEqual([]);
    });

    it("returns empty array when connection not found", async () => {
      const options = await webexProvider.getConnectionOptions!({
        resolverName: "roomOptions",
        connectionId: "conn-1",
        context: {},
        logger: mockLogger,
        getConnectionWithCredentials: async () => undefined,
      });

      expect(options).toEqual([]);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Delivery
  // ─────────────────────────────────────────────────────────────────────────

  describe("deliver", () => {
    it("sends message to Webex room successfully", async () => {
      let capturedBody: string | undefined;

      const mockFetch = spyOn(globalThis, "fetch").mockImplementation((async (
        _url: RequestInfo | URL,
        options?: RequestInit
      ) => {
        capturedBody = options?.body as string;
        return new Response(JSON.stringify({ id: "msg-456" }), {
          status: 200,
        });
      }) as unknown as typeof fetch);

      try {
        const result = await webexProvider.deliver({
          event: {
            eventId: "incident.created",
            payload: { incidentId: "inc-123", title: "Server Down" },
            timestamp: new Date().toISOString(),
            deliveryId: "del-789",
          },
          subscription: {
            id: "sub-1",
            name: "Incident Notifications",
          },
          providerConfig: {
            connectionId: "conn-1",
            roomId: "room-123",
          },
          logger: mockLogger,
          getConnectionWithCredentials: async () => ({
            id: "conn-1",
            config: { botToken: "test-token" },
          }),
        });

        expect(result.success).toBe(true);
        expect(result.externalId).toBe("msg-456");

        const parsedBody = JSON.parse(capturedBody!);
        expect(parsedBody.roomId).toBe("room-123");
        expect(parsedBody.markdown).toContain("incident.created");
      } finally {
        mockFetch.mockRestore();
      }
    });

    it("uses custom message template when provided", async () => {
      let capturedBody: string | undefined;

      const mockFetch = spyOn(globalThis, "fetch").mockImplementation((async (
        _url: RequestInfo | URL,
        options?: RequestInit
      ) => {
        capturedBody = options?.body as string;
        return new Response(JSON.stringify({ id: "msg-456" }), {
          status: 200,
        });
      }) as unknown as typeof fetch);

      try {
        await webexProvider.deliver({
          event: {
            eventId: "incident.created",
            payload: { incidentId: "inc-123", title: "Server Down" },
            timestamp: new Date().toISOString(),
            deliveryId: "del-789",
          },
          subscription: {
            id: "sub-1",
            name: "Test Sub",
          },
          providerConfig: {
            connectionId: "conn-1",
            roomId: "room-123",
            messageTemplate:
              "🚨 **{{event.payload.title}}** - Incident {{event.payload.incidentId}}",
          },
          logger: mockLogger,
          getConnectionWithCredentials: async () => ({
            id: "conn-1",
            config: { botToken: "test-token" },
          }),
        });

        const parsedBody = JSON.parse(capturedBody!);
        expect(parsedBody.markdown).toBe(
          "🚨 **Server Down** - Incident inc-123"
        );
      } finally {
        mockFetch.mockRestore();
      }
    });

    it("returns error when connection not found", async () => {
      const result = await webexProvider.deliver({
        event: {
          eventId: "test.event",
          payload: {},
          timestamp: new Date().toISOString(),
          deliveryId: "del-1",
        },
        subscription: { id: "sub-1", name: "Test" },
        providerConfig: {
          connectionId: "nonexistent",
          roomId: "room-1",
        },
        logger: mockLogger,
        getConnectionWithCredentials: async () => undefined,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });

    it("returns error when credentials not available", async () => {
      const result = await webexProvider.deliver({
        event: {
          eventId: "test.event",
          payload: {},
          timestamp: new Date().toISOString(),
          deliveryId: "del-1",
        },
        subscription: { id: "sub-1", name: "Test" },
        providerConfig: {
          connectionId: "conn-1",
          roomId: "room-1",
        },
        logger: mockLogger,
        // getConnectionWithCredentials not provided
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("not available");
    });
  });
});
