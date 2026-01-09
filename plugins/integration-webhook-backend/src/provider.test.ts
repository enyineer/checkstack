import { describe, it, expect, beforeEach, mock, spyOn } from "bun:test";
import {
  webhookProvider,
  webhookConfigSchemaV1,
  type WebhookConfig,
} from "./provider";
import type { IntegrationDeliveryContext } from "@checkmate-monitor/integration-backend";

/**
 * Unit tests for the Webhook Integration Provider.
 *
 * Tests cover:
 * - Config schema validation
 * - Successful webhook delivery
 * - Authentication methods (bearer, basic, header)
 * - Error handling and retry logic
 * - Test connection functionality
 */

// Mock logger
const mockLogger = {
  debug: mock(() => {}),
  info: mock(() => {}),
  warn: mock(() => {}),
  error: mock(() => {}),
};

// Create a test delivery context
function createTestContext(
  configOverrides: Partial<WebhookConfig> = {}
): IntegrationDeliveryContext<WebhookConfig> {
  const defaultConfig: WebhookConfig = {
    url: "https://example.com/webhook",
    method: "POST",
    contentType: "application/json",
    authType: "none",
    timeout: 10_000,
    ...configOverrides,
  };

  return {
    event: {
      eventId: "test-plugin.incident.created",
      payload: { incidentId: "inc-123", severity: "critical" },
      timestamp: new Date().toISOString(),
      deliveryId: "del-456",
    },
    subscription: {
      id: "sub-789",
      name: "Test Subscription",
    },
    providerConfig: defaultConfig,
    logger: mockLogger,
  };
}

describe("WebhookProvider", () => {
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
      expect(webhookProvider.id).toBe("webhook");
      expect(webhookProvider.displayName).toBe("Webhook");
      expect(webhookProvider.description).toContain("HTTP POST");
      expect(webhookProvider.icon).toBe("Webhook");
    });

    it("has a versioned config schema", () => {
      expect(webhookProvider.config).toBeDefined();
      expect(webhookProvider.config.version).toBe(1);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Config Schema Validation
  // ─────────────────────────────────────────────────────────────────────────

  describe("config schema", () => {
    it("requires valid URL", () => {
      expect(() => {
        webhookConfigSchemaV1.parse({
          url: "not-a-url",
        });
      }).toThrow();
    });

    it("accepts valid URL", () => {
      const result = webhookConfigSchemaV1.parse({
        url: "https://example.com/webhook",
      });
      expect(result.url).toBe("https://example.com/webhook");
    });

    it("applies default values", () => {
      const result = webhookConfigSchemaV1.parse({
        url: "https://example.com/webhook",
      });

      expect(result.method).toBe("POST");
      expect(result.contentType).toBe("application/json");
      expect(result.authType).toBe("none");
      expect(result.timeout).toBe(10_000);
    });

    it("validates method enum", () => {
      expect(() => {
        webhookConfigSchemaV1.parse({
          url: "https://example.com",
          method: "DELETE", // Not allowed
        });
      }).toThrow();
    });

    it("allows valid methods", () => {
      for (const method of ["POST", "PUT", "PATCH"] as const) {
        const result = webhookConfigSchemaV1.parse({
          url: "https://example.com",
          method,
        });
        expect(result.method).toBe(method);
      }
    });

    it("validates timeout range", () => {
      expect(() => {
        webhookConfigSchemaV1.parse({
          url: "https://example.com",
          timeout: 500, // Too short
        });
      }).toThrow();

      expect(() => {
        webhookConfigSchemaV1.parse({
          url: "https://example.com",
          timeout: 100_000, // Too long
        });
      }).toThrow();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Delivery - Basic
  // ─────────────────────────────────────────────────────────────────────────

  describe("deliver - basic", () => {
    it("makes HTTP request with correct payload structure", async () => {
      let capturedBody: string | undefined;
      let capturedHeaders: Record<string, string> | undefined;

      const mockFetch = spyOn(globalThis, "fetch").mockImplementation((async (
        _url: RequestInfo | URL,
        options?: RequestInit
      ) => {
        capturedBody = options?.body as string;
        capturedHeaders = options?.headers as Record<string, string>;
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }) as unknown as typeof fetch);

      try {
        const context = createTestContext();
        const result = await webhookProvider.deliver(context);

        expect(result.success).toBe(true);
        expect(capturedBody).toBeDefined();

        const parsedBody = JSON.parse(capturedBody!);
        expect(parsedBody.id).toBe("del-456");
        expect(parsedBody.eventType).toBe("test-plugin.incident.created");
        expect(parsedBody.subscription.id).toBe("sub-789");
        expect(parsedBody.data).toEqual({
          incidentId: "inc-123",
          severity: "critical",
        });

        expect(capturedHeaders?.["Content-Type"]).toBe("application/json");
        expect(capturedHeaders?.["X-Delivery-Id"]).toBe("del-456");
        expect(capturedHeaders?.["X-Event-Type"]).toBe(
          "test-plugin.incident.created"
        );
      } finally {
        mockFetch.mockRestore();
      }
    });

    it("returns external ID from response if present", async () => {
      const mockFetch = spyOn(globalThis, "fetch").mockImplementation(
        (async () => {
          return new Response(JSON.stringify({ id: "external-id-123" }), {
            status: 200,
          });
        }) as unknown as typeof fetch
      );

      try {
        const context = createTestContext();
        const result = await webhookProvider.deliver(context);

        expect(result.success).toBe(true);
        expect(result.externalId).toBe("external-id-123");
      } finally {
        mockFetch.mockRestore();
      }
    });

    it("handles non-JSON response gracefully", async () => {
      const mockFetch = spyOn(globalThis, "fetch").mockImplementation(
        (async () => {
          return new Response("OK", { status: 200 });
        }) as unknown as typeof fetch
      );

      try {
        const context = createTestContext();
        const result = await webhookProvider.deliver(context);

        expect(result.success).toBe(true);
        expect(result.externalId).toBeUndefined();
      } finally {
        mockFetch.mockRestore();
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Delivery - Authentication
  // ─────────────────────────────────────────────────────────────────────────

  describe("deliver - authentication", () => {
    it("adds Bearer token header", async () => {
      let capturedHeaders: Record<string, string> | undefined;

      const mockFetch = spyOn(globalThis, "fetch").mockImplementation((async (
        _url: RequestInfo | URL,
        options?: RequestInit
      ) => {
        capturedHeaders = options?.headers as Record<string, string>;
        return new Response("OK", { status: 200 });
      }) as unknown as typeof fetch);

      try {
        const context = createTestContext({
          authType: "bearer",
          bearerToken: "my-secret-token",
        });
        await webhookProvider.deliver(context);

        expect(capturedHeaders?.["Authorization"]).toBe(
          "Bearer my-secret-token"
        );
      } finally {
        mockFetch.mockRestore();
      }
    });

    it("adds Basic auth header", async () => {
      let capturedHeaders: Record<string, string> | undefined;

      const mockFetch = spyOn(globalThis, "fetch").mockImplementation((async (
        _url: RequestInfo | URL,
        options?: RequestInit
      ) => {
        capturedHeaders = options?.headers as Record<string, string>;
        return new Response("OK", { status: 200 });
      }) as unknown as typeof fetch);

      try {
        const context = createTestContext({
          authType: "basic",
          basicUsername: "user",
          basicPassword: "pass",
        });
        await webhookProvider.deliver(context);

        // user:pass in base64
        const expectedAuth = `Basic ${Buffer.from("user:pass").toString(
          "base64"
        )}`;
        expect(capturedHeaders?.["Authorization"]).toBe(expectedAuth);
      } finally {
        mockFetch.mockRestore();
      }
    });

    it("adds custom auth header", async () => {
      let capturedHeaders: Record<string, string> | undefined;

      const mockFetch = spyOn(globalThis, "fetch").mockImplementation((async (
        _url: RequestInfo | URL,
        options?: RequestInit
      ) => {
        capturedHeaders = options?.headers as Record<string, string>;
        return new Response("OK", { status: 200 });
      }) as unknown as typeof fetch);

      try {
        const context = createTestContext({
          authType: "header",
          authHeaderName: "X-API-Key",
          authHeaderValue: "api-key-123",
        });
        await webhookProvider.deliver(context);

        expect(capturedHeaders?.["X-API-Key"]).toBe("api-key-123");
      } finally {
        mockFetch.mockRestore();
      }
    });

    it("adds custom headers", async () => {
      let capturedHeaders: Record<string, string> | undefined;

      const mockFetch = spyOn(globalThis, "fetch").mockImplementation((async (
        _url: RequestInfo | URL,
        options?: RequestInit
      ) => {
        capturedHeaders = options?.headers as Record<string, string>;
        return new Response("OK", { status: 200 });
      }) as unknown as typeof fetch);

      try {
        const context = createTestContext({
          customHeaders: [
            { name: "X-Custom-Header", value: "custom-value" },
            { name: "X-Another-Header", value: "another-value" },
          ],
        });
        await webhookProvider.deliver(context);

        expect(capturedHeaders?.["X-Custom-Header"]).toBe("custom-value");
        expect(capturedHeaders?.["X-Another-Header"]).toBe("another-value");
      } finally {
        mockFetch.mockRestore();
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Delivery - Error Handling
  // ─────────────────────────────────────────────────────────────────────────

  describe("deliver - error handling", () => {
    it("returns error for non-OK response", async () => {
      const mockFetch = spyOn(globalThis, "fetch").mockImplementation(
        (async () => {
          return new Response("Not Found", { status: 404 });
        }) as unknown as typeof fetch
      );

      try {
        const context = createTestContext();
        const result = await webhookProvider.deliver(context);

        expect(result.success).toBe(false);
        expect(result.error).toContain("404");
      } finally {
        mockFetch.mockRestore();
      }
    });

    it("returns retryable error for configured status codes", async () => {
      const mockFetch = spyOn(globalThis, "fetch").mockImplementation(
        (async () => {
          return new Response("Too Many Requests", { status: 429 });
        }) as unknown as typeof fetch
      );

      try {
        const context = createTestContext({
          retryOnStatus: [429, 503],
        });
        const result = await webhookProvider.deliver(context);

        expect(result.success).toBe(false);
        expect(result.error).toContain("retryable");
        expect(result.retryAfterMs).toBeDefined();
      } finally {
        mockFetch.mockRestore();
      }
    });

    it("parses Retry-After header", async () => {
      const mockFetch = spyOn(globalThis, "fetch").mockImplementation(
        (async () => {
          const headers = new Headers();
          headers.set("Retry-After", "60");
          return new Response("Too Many Requests", {
            status: 429,
            headers,
          });
        }) as unknown as typeof fetch
      );

      try {
        const context = createTestContext({
          retryOnStatus: [429],
        });
        const result = await webhookProvider.deliver(context);

        expect(result.retryAfterMs).toBe(60_000);
      } finally {
        mockFetch.mockRestore();
      }
    });

    it("handles network errors with retry", async () => {
      const mockFetch = spyOn(globalThis, "fetch").mockImplementation(
        (async () => {
          throw new Error("ECONNREFUSED");
        }) as unknown as typeof fetch
      );

      try {
        const context = createTestContext();
        const result = await webhookProvider.deliver(context);

        expect(result.success).toBe(false);
        expect(result.error).toContain("ECONNREFUSED");
        expect(result.retryAfterMs).toBe(30_000);
      } finally {
        mockFetch.mockRestore();
      }
    });

    it("handles timeout errors with retry", async () => {
      const mockFetch = spyOn(globalThis, "fetch").mockImplementation(
        (async () => {
          throw new Error("timeout");
        }) as unknown as typeof fetch
      );

      try {
        const context = createTestContext();
        const result = await webhookProvider.deliver(context);

        expect(result.success).toBe(false);
        expect(result.retryAfterMs).toBe(30_000);
      } finally {
        mockFetch.mockRestore();
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Content Types
  // ─────────────────────────────────────────────────────────────────────────

  describe("content types", () => {
    it("sends JSON body for application/json", async () => {
      let capturedBody: string | undefined;
      let capturedContentType: string | undefined;

      const mockFetch = spyOn(globalThis, "fetch").mockImplementation((async (
        _url: RequestInfo | URL,
        options?: RequestInit
      ) => {
        capturedBody = options?.body as string;
        capturedContentType = (options?.headers as Record<string, string>)?.[
          "Content-Type"
        ];
        return new Response("OK", { status: 200 });
      }) as unknown as typeof fetch);

      try {
        const context = createTestContext({
          contentType: "application/json",
        });
        await webhookProvider.deliver(context);

        expect(capturedContentType).toBe("application/json");
        expect(() => JSON.parse(capturedBody!)).not.toThrow();
      } finally {
        mockFetch.mockRestore();
      }
    });

    it("sends form-encoded body for application/x-www-form-urlencoded", async () => {
      let capturedBody: string | undefined;
      let capturedContentType: string | undefined;

      const mockFetch = spyOn(globalThis, "fetch").mockImplementation((async (
        _url: RequestInfo | URL,
        options?: RequestInit
      ) => {
        capturedBody = options?.body as string;
        capturedContentType = (options?.headers as Record<string, string>)?.[
          "Content-Type"
        ];
        return new Response("OK", { status: 200 });
      }) as unknown as typeof fetch);

      try {
        const context = createTestContext({
          contentType: "application/x-www-form-urlencoded",
        });
        await webhookProvider.deliver(context);

        expect(capturedContentType).toBe("application/x-www-form-urlencoded");
        expect(capturedBody).toContain("payload=");
      } finally {
        mockFetch.mockRestore();
      }
    });
  });
});
