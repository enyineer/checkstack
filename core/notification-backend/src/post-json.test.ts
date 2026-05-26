import { describe, it, expect, mock } from "bun:test";
import type { Logger } from "@checkstack/backend-api";
import { postJson } from "./post-json";

function makeLogger(): Logger {
  return {
    info: mock(() => {}),
    error: mock(() => {}),
    warn: mock(() => {}),
    debug: mock(() => {}),
  };
}

describe("postJson", () => {
  it("returns ok:true with the response on 2xx", async () => {
    const responses: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async (url: RequestInfo | URL) => {
      responses.push(String(url));
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;
    try {
      const logger = makeLogger();
      const result = await postJson({
        url: "https://example.test/hook",
        body: { hello: "world" },
        serviceName: "Test",
        logger,
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.response.status).toBe(204);
      }
      expect(responses).toEqual(["https://example.test/hook"]);
      expect(logger.error).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("returns ok:false with a service-tagged error on non-2xx", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async () =>
      new Response("Bad request body", { status: 400 }),
    ) as unknown as typeof fetch;
    try {
      const logger = makeLogger();
      const result = await postJson({
        url: "https://example.test/hook",
        body: { hello: "world" },
        serviceName: "Discord",
        logger,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("Failed to send Discord message: 400");
      }
      expect(logger.error).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("returns ok:false when fetch rejects (network / timeout)", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    try {
      const logger = makeLogger();
      const result = await postJson({
        url: "https://example.test/hook",
        body: {},
        serviceName: "Slack",
        logger,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe(
          "Failed to send Slack notification: ECONNREFUSED",
        );
      }
      expect(logger.error).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("merges caller headers on top of the default Content-Type", async () => {
    let observedHeaders: Headers | undefined;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async (_url: RequestInfo | URL, init?: RequestInit) => {
      observedHeaders = new Headers(init?.headers);
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;
    try {
      await postJson({
        url: "https://example.test/hook",
        body: {},
        headers: { Authorization: "Bearer token" },
        serviceName: "Webex",
        logger: makeLogger(),
      });
      expect(observedHeaders?.get("content-type")).toBe("application/json");
      expect(observedHeaders?.get("authorization")).toBe("Bearer token");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("truncates long error bodies in the log payload", async () => {
    const longBody = "x".repeat(2_000);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async () =>
      new Response(longBody, { status: 500 }),
    ) as unknown as typeof fetch;
    try {
      const logger = makeLogger();
      await postJson({
        url: "https://example.test/hook",
        body: {},
        serviceName: "Gotify",
        logger,
      });
      const errorCall = (logger.error as ReturnType<typeof mock>).mock
        .calls[0];
      const meta = errorCall?.[1] as { error: string } | undefined;
      expect(meta?.error.length).toBe(500);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
