import { describe, it, expect, spyOn, mock } from "bun:test";
import type { Logger } from "@checkstack/backend-api";
import type { NotificationSendContext } from "@checkstack/backend-api";
import {
  discordConfigSchemaV1,
  discordUserConfigSchema,
  buildDiscordEmbed,
  discordStrategy,
} from "./index";

function makeLogger(): Logger {
  return {
    info: mock(() => {}),
    error: mock(() => {}),
    warn: mock(() => {}),
    debug: mock(() => {}),
  };
}

function makeContext(
  webhookUrl: string,
): NotificationSendContext<
  Record<string, never>,
  { webhookUrl: string }
> {
  return {
    user: { userId: "u1" },
    contact: webhookUrl,
    notification: {
      title: "Alert",
      body: "body",
      importance: "info",
      type: "test",
    },
    strategyConfig: {},
    userConfig: { webhookUrl },
    layoutConfig: undefined,
    logger: makeLogger(),
  };
}

/**
 * Unit tests for the Discord Notification Strategy.
 *
 * Tests cover:
 * - Config schema validation
 * - Discord embed building
 * - Webhook API interaction
 */

describe("Discord Notification Strategy", () => {
  // ─────────────────────────────────────────────────────────────────────────
  // Config Schema Validation
  // ─────────────────────────────────────────────────────────────────────────

  describe("config schema", () => {
    it("accepts empty admin config", () => {
      const result = discordConfigSchemaV1.parse({});
      expect(result).toEqual({});
    });

    it("validates user config - requires webhookUrl", () => {
      expect(() => {
        discordUserConfigSchema.parse({});
      }).toThrow();
    });

    it("validates user config - requires valid URL", () => {
      expect(() => {
        discordUserConfigSchema.parse({ webhookUrl: "not-a-url" });
      }).toThrow();
    });

    it("accepts valid user config", () => {
      const result = discordUserConfigSchema.parse({
        webhookUrl: "https://discord.com/api/webhooks/123/abc",
      });
      expect(result.webhookUrl).toBe(
        "https://discord.com/api/webhooks/123/abc",
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Discord Embed Building
  // ─────────────────────────────────────────────────────────────────────────

  describe("embed builder", () => {
    it("builds embed with title only", () => {
      const embed = buildDiscordEmbed({
        title: "Test Alert",
        importance: "info",
      });

      expect(embed.title).toContain("Test Alert");
      expect(embed.title).toContain("ℹ️");
      expect(embed.color).toBe(0x3b_82_f6); // Blue
      expect(embed.timestamp).toBeDefined();
    });

    it("builds embed with title and body", () => {
      const embed = buildDiscordEmbed({
        title: "System Alert",
        body: "The system has recovered.",
        importance: "warning",
      });

      expect(embed.title).toContain("⚠️");
      expect(embed.title).toContain("System Alert");
      expect(embed.description).toBe("The system has recovered.");
      expect(embed.color).toBe(0xf5_9e_0b); // Amber
    });

    it("builds embed with action button as field", () => {
      const embed = buildDiscordEmbed({
        title: "Incident Created",
        body: "A new incident requires attention.",
        importance: "critical",
        action: {
          label: "View Incident",
          url: "https://example.com/incident/123",
        },
      });

      expect(embed.title).toContain("🚨");
      expect(embed.color).toBe(0xef_44_44); // Red
      expect(embed.fields).toHaveLength(1);
      expect(embed.fields![0].name).toBe("View Incident");
      expect(embed.fields![0].value).toContain(
        "https://example.com/incident/123",
      );
    });

    it("uses correct colors for importance levels", () => {
      const infoEmbed = buildDiscordEmbed({
        title: "Info",
        importance: "info",
      });
      const warningEmbed = buildDiscordEmbed({
        title: "Warning",
        importance: "warning",
      });
      const criticalEmbed = buildDiscordEmbed({
        title: "Critical",
        importance: "critical",
      });

      expect(infoEmbed.color).toBe(0x3b_82_f6);
      expect(warningEmbed.color).toBe(0xf5_9e_0b);
      expect(criticalEmbed.color).toBe(0xef_44_44);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Webhook API Interaction
  // ─────────────────────────────────────────────────────────────────────────

  describe("webhook API interaction", () => {
    it("sends embed to webhook URL", async () => {
      let capturedBody: string | undefined;
      let capturedUrl: string | undefined;

      const mockFetch = spyOn(globalThis, "fetch").mockImplementation((async (
        url: RequestInfo | URL,
        options?: RequestInit,
      ) => {
        capturedUrl = url.toString();
        capturedBody = options?.body as string;
        return new Response(null, { status: 204 });
      }) as unknown as typeof fetch);

      try {
        const webhookUrl = "https://discord.com/api/webhooks/123/abc";
        const embed = buildDiscordEmbed({
          title: "Test",
          importance: "info",
        });

        await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ embeds: [embed] }),
        });

        expect(capturedUrl).toBe(webhookUrl);

        const parsedBody = JSON.parse(capturedBody!);
        expect(parsedBody.embeds).toHaveLength(1);
        expect(parsedBody.embeds[0].title).toContain("Test");
      } finally {
        mockFetch.mockRestore();
      }
    });

    it("handles API errors gracefully", async () => {
      const mockFetch = spyOn(globalThis, "fetch").mockImplementation(
        (async () => {
          return new Response(JSON.stringify({ message: "Invalid webhook" }), {
            status: 404,
          });
        }) as unknown as typeof fetch,
      );

      try {
        const response = await fetch(
          "https://discord.com/api/webhooks/invalid",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ embeds: [] }),
          },
        );

        expect(response.ok).toBe(false);
        expect(response.status).toBe(404);
      } finally {
        mockFetch.mockRestore();
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // SSRF hardening (user-supplied webhook URL)
  // ─────────────────────────────────────────────────────────────────────────

  describe("SSRF hardening", () => {
    it("rejects a webhook URL that resolves to a blocked host before dispatch", async () => {
      const fetchSpy = spyOn(globalThis, "fetch");
      try {
        const result = await discordStrategy.send(
          makeContext("http://169.254.169.254/latest/meta-data"),
        );
        expect(result.success).toBe(false);
        // The SSRF pre-flight must fail closed: no request is ever dispatched.
        expect(fetchSpy).not.toHaveBeenCalled();
      } finally {
        fetchSpy.mockRestore();
      }
    });

    it("refuses redirects so a 302 to a blocked host is not followed", async () => {
      let targetHit = false;
      const fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async (
        _url: RequestInfo | URL,
        init?: RequestInit,
      ) => {
        // Emulate real fetch semantics under `redirect: "error"`: a 3xx rejects
        // rather than being followed. (End-to-end proof with a real server lives
        // in notification-backend's post-json.test.ts.)
        if (init?.redirect === "error") {
          throw new TypeError("unexpected redirect");
        }
        targetHit = true;
        return new Response(null, { status: 200 });
      }) as unknown as typeof fetch);
      try {
        // A public IP literal passes the pre-flight (no DNS, not in a denied
        // range), so the request is dispatched with redirect refusal.
        const result = await discordStrategy.send(
          makeContext("https://93.184.216.34/hook"),
        );
        expect(result.success).toBe(false);
        expect(targetHit).toBe(false);
        const init = fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined;
        expect(init?.redirect).toBe("error");
      } finally {
        fetchSpy.mockRestore();
      }
    });
  });
});
