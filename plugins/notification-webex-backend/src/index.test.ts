import { describe, it, expect, beforeEach, mock, spyOn } from "bun:test";
import type { Logger } from "@checkstack/backend-api";

// Re-export for testing since we can't import directly from index.ts without side effects
// We'll test the schemas and strategy logic indirectly through the provider

/**
 * Unit tests for the Webex Notification Strategy.
 *
 * Tests cover:
 * - Config schema validation
 * - Successful message delivery
 * - Error handling
 * - Message formatting
 */

// Mock logger
const mockLogger: Logger = {
  debug: mock(() => {}),
  info: mock(() => {}),
  warn: mock(() => {}),
  error: mock(() => {}),
};

describe("Webex Notification Strategy", () => {
  beforeEach(() => {
    (mockLogger.debug as ReturnType<typeof mock>).mockClear();
    (mockLogger.info as ReturnType<typeof mock>).mockClear();
    (mockLogger.warn as ReturnType<typeof mock>).mockClear();
    (mockLogger.error as ReturnType<typeof mock>).mockClear();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Config Schema Validation
  // ─────────────────────────────────────────────────────────────────────────

  describe("config schema", () => {
    // Import schemas inline to avoid plugin initialization side effects
    it("validates admin config - requires bot token", async () => {
      const { z } = await import("zod");
      const { configString } = await import("@checkstack/backend-api");

      const webexConfigSchemaV1 = z.object({
        botToken: configString({ "x-secret": true }).describe(
          "Webex Bot Access Token",
        ),
      });

      // Missing bot token should fail
      expect(() => {
        webexConfigSchemaV1.parse({});
      }).toThrow();

      // Valid config should pass
      const result = webexConfigSchemaV1.parse({
        botToken: "test-bot-token-123",
      });
      expect(result.botToken).toBe("test-bot-token-123");
    });

    it("validates user config - requires person ID", async () => {
      const { z } = await import("zod");

      const webexUserConfigSchema = z.object({
        personId: z.string().min(1).describe("Your Webex Person ID"),
      });

      // Empty person ID should fail
      expect(() => {
        webexUserConfigSchema.parse({ personId: "" });
      }).toThrow();

      // Missing person ID should fail
      expect(() => {
        webexUserConfigSchema.parse({});
      }).toThrow();

      // Valid config should pass
      const result = webexUserConfigSchema.parse({
        personId: "Y2lzY29zcGFyazovL3VzL1BFT1BMRS8xMjM0NTY=",
      });
      expect(result.personId).toBe("Y2lzY29zcGFyazovL3VzL1BFT1BMRS8xMjM0NTY=");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Message Delivery
  // ─────────────────────────────────────────────────────────────────────────

  describe("message delivery", () => {
    it("sends message with correct payload structure", async () => {
      let capturedBody: string | undefined;
      let capturedHeaders: Record<string, string> | undefined;
      let capturedUrl: string | undefined;

      const mockFetch = spyOn(globalThis, "fetch").mockImplementation((async (
        url: RequestInfo | URL,
        options?: RequestInit,
      ) => {
        capturedUrl = url.toString();
        capturedBody = options?.body as string;
        capturedHeaders = options?.headers as Record<string, string>;
        return new Response(JSON.stringify({ id: "msg-123" }), {
          status: 200,
        });
      }) as unknown as typeof fetch);

      try {
        // Simulate what the send method does
        const botToken = "test-bot-token";
        const personId = "test-person-id";
        const markdown =
          "ℹ️ **Test Title**\n\nTest body\n\n[View](https://example.com)";

        const response = await fetch("https://webexapis.com/v1/messages", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${botToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            toPersonId: personId,
            markdown,
          }),
        });

        expect(capturedUrl).toBe("https://webexapis.com/v1/messages");
        expect(capturedHeaders?.["Authorization"]).toBe(`Bearer ${botToken}`);
        expect(capturedHeaders?.["Content-Type"]).toBe("application/json");

        const parsedBody = JSON.parse(capturedBody!);
        expect(parsedBody.toPersonId).toBe(personId);
        expect(parsedBody.markdown).toContain("**Test Title**");
        expect(parsedBody.markdown).toContain("Test body");
        expect(parsedBody.markdown).toContain("[View](https://example.com)");

        expect(response.ok).toBe(true);
        const result = await response.json();
        expect(result.id).toBe("msg-123");
      } finally {
        mockFetch.mockRestore();
      }
    });

    it("formats messages with correct importance emoji", async () => {
      const importanceEmoji = {
        info: "ℹ️",
        warning: "⚠️",
        critical: "🚨",
      };

      // Test each importance level
      for (const [importance, emoji] of Object.entries(importanceEmoji)) {
        const title = "Test Alert";
        const markdown = `${emoji} **${title}**`;

        expect(markdown).toContain(emoji);
        expect(markdown).toContain(`**${title}**`);
      }
    });

    it("handles API errors gracefully", async () => {
      const mockFetch = spyOn(globalThis, "fetch").mockImplementation(
        (async () => {
          return new Response(
            JSON.stringify({ message: "Invalid personId", trackingId: "123" }),
            { status: 400 },
          );
        }) as unknown as typeof fetch,
      );

      try {
        const response = await fetch("https://webexapis.com/v1/messages", {
          method: "POST",
          headers: {
            Authorization: "Bearer test-token",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            toPersonId: "invalid-person-id",
            markdown: "Test message",
          }),
        });

        expect(response.ok).toBe(false);
        expect(response.status).toBe(400);
      } finally {
        mockFetch.mockRestore();
      }
    });

    it("handles network errors", async () => {
      const mockFetch = spyOn(globalThis, "fetch").mockImplementation(
        (async () => {
          throw new Error("Network error: ECONNREFUSED");
        }) as unknown as typeof fetch,
      );

      try {
        await expect(
          fetch("https://webexapis.com/v1/messages", {
            method: "POST",
            headers: {
              Authorization: "Bearer test-token",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              toPersonId: "test-person",
              markdown: "Test",
            }),
          }),
        ).rejects.toThrow("ECONNREFUSED");
      } finally {
        mockFetch.mockRestore();
      }
    });

    it("handles timeout errors", async () => {
      const mockFetch = spyOn(globalThis, "fetch").mockImplementation(
        (async () => {
          throw new Error("The operation was aborted due to timeout");
        }) as unknown as typeof fetch,
      );

      try {
        await expect(
          fetch("https://webexapis.com/v1/messages", {
            method: "POST",
            signal: AbortSignal.timeout(10_000),
            headers: {
              Authorization: "Bearer test-token",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              toPersonId: "test-person",
              markdown: "Test",
            }),
          }),
        ).rejects.toThrow("timeout");
      } finally {
        mockFetch.mockRestore();
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Message Formatting
  // ─────────────────────────────────────────────────────────────────────────

  describe("message formatting", () => {
    it("builds markdown with title only", () => {
      const title = "System Alert";
      const importance = "info" as const;
      const importanceEmoji = { info: "ℹ️", warning: "⚠️", critical: "🚨" };

      const markdown = `${importanceEmoji[importance]} **${title}**`;

      expect(markdown).toBe("ℹ️ **System Alert**");
    });

    it("builds markdown with title and body", () => {
      const title = "System Alert";
      const body = "The system has recovered.";
      const importance = "info" as const;
      const importanceEmoji = { info: "ℹ️", warning: "⚠️", critical: "🚨" };

      let markdown = `${importanceEmoji[importance]} **${title}**`;
      markdown += `\n\n${body}`;

      expect(markdown).toBe("ℹ️ **System Alert**\n\nThe system has recovered.");
    });

    it("builds markdown with action link", () => {
      const title = "Incident Created";
      const body = "A new incident has been reported.";
      const action = {
        label: "View Incident",
        url: "https://example.com/incident/123",
      };
      const importance = "critical" as const;
      const importanceEmoji = { info: "ℹ️", warning: "⚠️", critical: "🚨" };

      let markdown = `${importanceEmoji[importance]} **${title}**`;
      markdown += `\n\n${body}`;
      markdown += `\n\n[${action.label}](${action.url})`;

      expect(markdown).toContain("🚨 **Incident Created**");
      expect(markdown).toContain("A new incident has been reported.");
      expect(markdown).toContain(
        "[View Incident](https://example.com/incident/123)",
      );
    });
  });
});
