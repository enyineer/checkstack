import { describe, it, expect, mock, setDefaultTimeout } from "bun:test";

// These spin real local HTTP servers per test - instant in isolation, but
// bun's 5s default trips when the full repo suite saturates the machine.
// Generous ceiling; the assertions are unchanged.
setDefaultTimeout(30_000);
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

  it("forwards the redirect option to fetch", async () => {
    let observedRedirect: RequestRedirect | undefined;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(
      async (_url: RequestInfo | URL, init?: RequestInit) => {
        observedRedirect = init?.redirect;
        return new Response(null, { status: 200 });
      },
    ) as unknown as typeof fetch;
    try {
      await postJson({
        url: "https://example.test/hook",
        body: {},
        redirect: "error",
        serviceName: "Webhook",
        logger: makeLogger(),
      });
      expect(observedRedirect).toBe("error");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("fails closed (does not follow) on a redirect when redirect:'error'", async () => {
    // Regression: a user-supplied webhook whose receiver answers 302 to an
    // internal host must NOT be followed - the pre-flight SSRF guard only saw
    // the original host. `redirect: "error"` makes fetch reject the redirect.
    let targetHit = false;
    const server = Bun.serve({
      port: 0,
      fetch(req): Response {
        const url = new URL(req.url);
        if (url.pathname === "/target") {
          targetHit = true;
          return new Response("ok", { status: 200 });
        }
        // Derive the redirect target from the request origin so the handler
        // never references `server` (which would be a self-referential init).
        return new Response(null, {
          status: 302,
          headers: { Location: `${url.origin}/target` },
        });
      },
    });
    try {
      const result = await postJson({
        url: `http://127.0.0.1:${server.port}/hook`,
        body: {},
        redirect: "error",
        serviceName: "Webhook",
        logger: makeLogger(),
      });
      expect(result.ok).toBe(false);
      expect(targetHit).toBe(false);
    } finally {
      server.stop(true);
    }
  });

  it("follows a redirect by default (trusted service endpoints)", async () => {
    let targetHit = false;
    const server = Bun.serve({
      port: 0,
      fetch(req): Response {
        const url = new URL(req.url);
        if (url.pathname === "/target") {
          targetHit = true;
          return new Response("ok", { status: 200 });
        }
        return new Response(null, {
          status: 302,
          headers: { Location: `${url.origin}/target` },
        });
      },
    });
    try {
      const result = await postJson({
        url: `http://127.0.0.1:${server.port}/hook`,
        body: {},
        serviceName: "Discord",
        logger: makeLogger(),
      });
      expect(result.ok).toBe(true);
      expect(targetHit).toBe(true);
    } finally {
      server.stop(true);
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
