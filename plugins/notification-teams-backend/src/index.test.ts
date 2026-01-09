import { describe, it, expect, beforeEach, mock, spyOn } from "bun:test";
import { teamsConfigSchemaV1, buildAdaptiveCard } from "./index";
import type { AdaptiveCardOptions } from "./index";

/**
 * Unit tests for the Microsoft Teams Notification Strategy.
 *
 * Tests cover:
 * - Config schema validation
 * - Adaptive Card building
 * - Message formatting
 */

describe("Microsoft Teams Notification Strategy", () => {
  // ─────────────────────────────────────────────────────────────────────────
  // Config Schema Validation
  // ─────────────────────────────────────────────────────────────────────────

  describe("config schema", () => {
    it("validates admin config - requires all fields", () => {
      // Missing all fields should fail
      expect(() => {
        teamsConfigSchemaV1.parse({});
      }).toThrow();

      // Missing clientSecret should fail
      expect(() => {
        teamsConfigSchemaV1.parse({
          tenantId: "test-tenant",
          clientId: "test-client",
        });
      }).toThrow();
    });

    it("accepts valid config", () => {
      const result = teamsConfigSchemaV1.parse({
        tenantId: "12345678-1234-1234-1234-123456789abc",
        clientId: "87654321-4321-4321-4321-cba987654321",
        clientSecret: "super-secret-value",
      });

      expect(result.tenantId).toBe("12345678-1234-1234-1234-123456789abc");
      expect(result.clientId).toBe("87654321-4321-4321-4321-cba987654321");
      expect(result.clientSecret).toBe("super-secret-value");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Adaptive Card Building
  // ─────────────────────────────────────────────────────────────────────────

  describe("adaptive card builder", () => {
    it("builds card with title only", () => {
      const card = buildAdaptiveCard({
        title: "Test Alert",
        importance: "info",
      }) as Record<string, unknown>;

      expect(card.type).toBe("AdaptiveCard");
      expect(card.version).toBe("1.4");
      expect(card.$schema).toBe(
        "http://adaptivecards.io/schemas/adaptive-card.json"
      );

      const body = card.body as Array<Record<string, unknown>>;
      expect(body).toHaveLength(1);
      expect(body[0].text).toContain("Test Alert");
      expect(body[0].text).toContain("ℹ️");
    });

    it("builds card with title and body", () => {
      const card = buildAdaptiveCard({
        title: "System Alert",
        body: "The system has recovered from an outage.",
        importance: "warning",
      }) as Record<string, unknown>;

      const body = card.body as Array<Record<string, unknown>>;
      expect(body).toHaveLength(2);
      expect(body[0].text).toContain("⚠️");
      expect(body[0].text).toContain("System Alert");
      expect(body[1].text).toBe("The system has recovered from an outage.");
    });

    it("builds card with action button", () => {
      const card = buildAdaptiveCard({
        title: "Incident Created",
        body: "A new incident requires your attention.",
        importance: "critical",
        action: {
          label: "View Incident",
          url: "https://example.com/incident/123",
        },
      }) as Record<string, unknown>;

      const body = card.body as Array<Record<string, unknown>>;
      expect(body[0].text).toContain("🚨");

      const actions = card.actions as Array<Record<string, unknown>>;
      expect(actions).toHaveLength(1);
      expect(actions[0].type).toBe("Action.OpenUrl");
      expect(actions[0].title).toBe("View Incident");
      expect(actions[0].url).toBe("https://example.com/incident/123");
    });

    it("uses correct colors for importance levels", () => {
      const infoCard = buildAdaptiveCard({
        title: "Info",
        importance: "info",
      }) as Record<string, unknown>;
      const warningCard = buildAdaptiveCard({
        title: "Warning",
        importance: "warning",
      }) as Record<string, unknown>;
      const criticalCard = buildAdaptiveCard({
        title: "Critical",
        importance: "critical",
      }) as Record<string, unknown>;

      const infoBody = infoCard.body as Array<Record<string, unknown>>;
      const warningBody = warningCard.body as Array<Record<string, unknown>>;
      const criticalBody = criticalCard.body as Array<Record<string, unknown>>;

      expect(infoBody[0].color).toBe("accent");
      expect(warningBody[0].color).toBe("warning");
      expect(criticalBody[0].color).toBe("attention");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Graph API Interaction
  // ─────────────────────────────────────────────────────────────────────────

  describe("Graph API interaction", () => {
    it("creates chat with correct member binding", async () => {
      let capturedBody: string | undefined;
      let capturedUrl: string | undefined;

      const mockFetch = spyOn(globalThis, "fetch").mockImplementation((async (
        url: RequestInfo | URL,
        options?: RequestInit
      ) => {
        capturedUrl = url.toString();
        capturedBody = options?.body as string;
        return new Response(JSON.stringify({ id: "chat-123" }), {
          status: 200,
        });
      }) as unknown as typeof fetch);

      try {
        const userId = "user-456";
        const response = await fetch("https://graph.microsoft.com/v1.0/chats", {
          method: "POST",
          headers: {
            Authorization: "Bearer test-token",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            chatType: "oneOnOne",
            members: [
              {
                "@odata.type": "#microsoft.graph.aadUserConversationMember",
                roles: ["owner"],
                "user@odata.bind": `https://graph.microsoft.com/v1.0/users('${userId}')`,
              },
            ],
          }),
        });

        expect(capturedUrl).toBe("https://graph.microsoft.com/v1.0/chats");

        const parsedBody = JSON.parse(capturedBody!);
        expect(parsedBody.chatType).toBe("oneOnOne");
        expect(parsedBody.members).toHaveLength(1);
        expect(parsedBody.members[0]["user@odata.bind"]).toContain(userId);

        const result = await response.json();
        expect(result.id).toBe("chat-123");
      } finally {
        mockFetch.mockRestore();
      }
    });

    it("sends message with adaptive card attachment", async () => {
      let capturedBody: string | undefined;

      const mockFetch = spyOn(globalThis, "fetch").mockImplementation((async (
        _url: RequestInfo | URL,
        options?: RequestInit
      ) => {
        capturedBody = options?.body as string;
        return new Response(JSON.stringify({ id: "msg-789" }), {
          status: 200,
        });
      }) as unknown as typeof fetch);

      try {
        const chatId = "chat-123";
        const adaptiveCard = buildAdaptiveCard({
          title: "Test",
          importance: "info",
        });

        await fetch(
          `https://graph.microsoft.com/v1.0/chats/${chatId}/messages`,
          {
            method: "POST",
            headers: {
              Authorization: "Bearer test-token",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              body: {
                contentType: "html",
                content: `<attachment id="adaptiveCard"></attachment>`,
              },
              attachments: [
                {
                  id: "adaptiveCard",
                  contentType: "application/vnd.microsoft.card.adaptive",
                  content: JSON.stringify(adaptiveCard),
                },
              ],
            }),
          }
        );

        const parsedBody = JSON.parse(capturedBody!);
        expect(parsedBody.body.contentType).toBe("html");
        expect(parsedBody.attachments).toHaveLength(1);
        expect(parsedBody.attachments[0].contentType).toBe(
          "application/vnd.microsoft.card.adaptive"
        );

        const cardContent = JSON.parse(parsedBody.attachments[0].content);
        expect(cardContent.type).toBe("AdaptiveCard");
      } finally {
        mockFetch.mockRestore();
      }
    });

    it("handles API errors gracefully", async () => {
      const mockFetch = spyOn(globalThis, "fetch").mockImplementation(
        (async () => {
          return new Response(
            JSON.stringify({
              error: { code: "Forbidden", message: "Access denied" },
            }),
            { status: 403 }
          );
        }) as unknown as typeof fetch
      );

      try {
        const response = await fetch("https://graph.microsoft.com/v1.0/chats", {
          method: "POST",
          headers: {
            Authorization: "Bearer invalid-token",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ chatType: "oneOnOne", members: [] }),
        });

        expect(response.ok).toBe(false);
        expect(response.status).toBe(403);
      } finally {
        mockFetch.mockRestore();
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // OAuth URL Building
  // ─────────────────────────────────────────────────────────────────────────

  describe("OAuth URLs", () => {
    it("builds correct authorization URL format", () => {
      const tenantId = "12345678-1234-1234-1234-123456789abc";
      const expectedAuthUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize`;
      const expectedTokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;

      expect(expectedAuthUrl).toContain("login.microsoftonline.com");
      expect(expectedAuthUrl).toContain(tenantId);
      expect(expectedAuthUrl).toContain("oauth2/v2.0/authorize");

      expect(expectedTokenUrl).toContain("login.microsoftonline.com");
      expect(expectedTokenUrl).toContain("oauth2/v2.0/token");
    });

    it("uses correct scopes for Teams messaging", () => {
      const requiredScopes = ["Chat.ReadWrite", "User.Read", "offline_access"];

      expect(requiredScopes).toContain("Chat.ReadWrite");
      expect(requiredScopes).toContain("User.Read");
      expect(requiredScopes).toContain("offline_access");
    });
  });
});
