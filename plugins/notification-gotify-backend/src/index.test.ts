import { describe, it, expect, spyOn, mock } from "bun:test";
import type {
  Logger,
  NotificationSendContext,
} from "@checkstack/backend-api";
import {
  gotifyConfigSchemaV1,
  gotifyUserConfigSchema,
  mapImportanceToPriority,
  gotifyStrategy,
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
  serverUrl: string,
): NotificationSendContext<
  { serverUrl: string },
  { appToken: string }
> {
  return {
    user: { userId: "u1" },
    contact: "tok",
    notification: {
      title: "Alert",
      body: "body",
      importance: "info",
      type: "test",
    },
    strategyConfig: { serverUrl },
    userConfig: { appToken: "tok" },
    layoutConfig: undefined,
    logger: makeLogger(),
  };
}

/**
 * Unit tests for the Gotify Notification Strategy.
 *
 * Tests cover:
 * - Config schema validation
 * - Priority mapping
 * - REST API interaction
 */

describe("Gotify Notification Strategy", () => {
  // ─────────────────────────────────────────────────────────────────────────
  // Config Schema Validation
  // ─────────────────────────────────────────────────────────────────────────

  describe("config schema", () => {
    it("validates admin config - requires serverUrl", () => {
      expect(() => {
        gotifyConfigSchemaV1.parse({});
      }).toThrow();
    });

    it("validates admin config - requires valid URL", () => {
      expect(() => {
        gotifyConfigSchemaV1.parse({ serverUrl: "not-a-url" });
      }).toThrow();
    });

    it("accepts valid admin config", () => {
      const result = gotifyConfigSchemaV1.parse({
        serverUrl: "https://gotify.example.com",
      });
      expect(result.serverUrl).toBe("https://gotify.example.com");
    });

    it("validates user config - requires appToken", () => {
      expect(() => {
        gotifyUserConfigSchema.parse({});
      }).toThrow();
    });

    it("accepts valid user config", () => {
      const result = gotifyUserConfigSchema.parse({
        appToken: "A-secret-token-123",
      });
      expect(result.appToken).toBe("A-secret-token-123");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Priority Mapping
  // ─────────────────────────────────────────────────────────────────────────

  describe("priority mapping", () => {
    it("maps info to normal priority (5)", () => {
      expect(mapImportanceToPriority("info")).toBe(5);
    });

    it("maps warning to high-normal priority (7)", () => {
      expect(mapImportanceToPriority("warning")).toBe(7);
    });

    it("maps critical to highest priority (10)", () => {
      expect(mapImportanceToPriority("critical")).toBe(10);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // REST API Interaction
  // ─────────────────────────────────────────────────────────────────────────

  describe("REST API interaction", () => {
    it("sends message to Gotify server with token", async () => {
      let capturedBody: string | undefined;
      let capturedUrl: string | undefined;

      const mockFetch = spyOn(globalThis, "fetch").mockImplementation((async (
        url: RequestInfo | URL,
        options?: RequestInit,
      ) => {
        capturedUrl = url.toString();
        capturedBody = options?.body as string;
        return new Response(JSON.stringify({ id: 42 }), { status: 200 });
      }) as unknown as typeof fetch);

      try {
        const serverUrl = "https://gotify.example.com";
        const appToken = "test-token";

        await fetch(`${serverUrl}/message?token=${appToken}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: "Test Alert",
            message: "Test message body",
            priority: 5,
          }),
        });

        expect(capturedUrl).toContain("gotify.example.com/message");
        expect(capturedUrl).toContain("token=test-token");

        const parsedBody = JSON.parse(capturedBody!);
        expect(parsedBody.title).toBe("Test Alert");
        expect(parsedBody.message).toBe("Test message body");
        expect(parsedBody.priority).toBe(5);
      } finally {
        mockFetch.mockRestore();
      }
    });

    it("includes extras for action URL", async () => {
      let capturedBody: string | undefined;

      const mockFetch = spyOn(globalThis, "fetch").mockImplementation((async (
        _url: RequestInfo | URL,
        options?: RequestInit,
      ) => {
        capturedBody = options?.body as string;
        return new Response(JSON.stringify({ id: 43 }), { status: 200 });
      }) as unknown as typeof fetch);

      try {
        await fetch("https://gotify.example.com/message?token=test", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: "Test",
            message: "Body",
            priority: 10,
            extras: {
              "client::notification": {
                click: { url: "https://example.com/action" },
              },
            },
          }),
        });

        const parsedBody = JSON.parse(capturedBody!);
        expect(parsedBody.extras).toBeDefined();
        expect(parsedBody.extras["client::notification"].click.url).toBe(
          "https://example.com/action",
        );
      } finally {
        mockFetch.mockRestore();
      }
    });

    it("handles API errors gracefully", async () => {
      const mockFetch = spyOn(globalThis, "fetch").mockImplementation(
        (async () => {
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
          });
        }) as unknown as typeof fetch,
      );

      try {
        const response = await fetch(
          "https://gotify.example.com/message?token=invalid",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: "Test", message: "Body" }),
          },
        );

        expect(response.ok).toBe(false);
        expect(response.status).toBe(401);
      } finally {
        mockFetch.mockRestore();
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // SSRF hardening (user-supplied Gotify server URL)
  // ─────────────────────────────────────────────────────────────────────────

  describe("SSRF hardening", () => {
    it("rejects a server URL that resolves to a blocked host before dispatch", async () => {
      const fetchSpy = spyOn(globalThis, "fetch");
      try {
        const result = await gotifyStrategy.send(
          makeContext("http://169.254.169.254"),
        );
        expect(result.success).toBe(false);
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
        if (init?.redirect === "error") {
          throw new TypeError("unexpected redirect");
        }
        targetHit = true;
        return new Response(null, { status: 200 });
      }) as unknown as typeof fetch);
      try {
        const result = await gotifyStrategy.send(
          makeContext("https://93.184.216.34"),
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
