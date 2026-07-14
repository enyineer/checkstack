import { describe, it, expect, mock } from "bun:test";
import type { Logger } from "./types";
import { createGuardedFetch, GuardedFetchError } from "./guarded-fetch";
import type { GuardedLookupFn } from "./guarded-fetch";

/** Minimal mock logger - the guarded fetch only ever calls `.debug`. */
function mockLogger(): Logger {
  const logger: Logger = {
    info: mock(),
    error: mock(),
    warn: mock(),
    debug: mock(),
    child: mock(() => mockLogger()),
  };
  return logger;
}

const PUBLIC_IP = "93.184.216.34";
const METADATA_IP = "169.254.169.254";

/** Resolve hostnames to fixed addresses so the SSRF guard is deterministic. */
const lookupFn: GuardedLookupFn = async (hostname) => {
  if (hostname === "blocked.example") {
    return [{ address: METADATA_IP, family: 4 }];
  }
  return [{ address: PUBLIC_IP, family: 4 }];
};

function guarded(fetchImpl: typeof fetch) {
  return createGuardedFetch({
    logger: mockLogger(),
    lookupFn,
    fetchImpl,
  });
}

describe("createGuardedFetch", () => {
  it("rejects a non-http(s) scheme without fetching", async () => {
    let called = false;
    const fetchImpl = (async () => {
      called = true;
      return new Response(null);
    }) as unknown as typeof fetch;
    await expect(guarded(fetchImpl)("file:///etc/passwd")).rejects.toBeInstanceOf(
      GuardedFetchError,
    );
    expect(called).toBe(false);
  });

  it("rejects a host that resolves to a denied range", async () => {
    let called = false;
    const fetchImpl = (async () => {
      called = true;
      return new Response(null);
    }) as unknown as typeof fetch;
    await expect(
      guarded(fetchImpl)("https://blocked.example/metrics"),
    ).rejects.toBeInstanceOf(GuardedFetchError);
    expect(called).toBe(false);
  });

  it("fetches an allowed host", async () => {
    const fetchImpl = (async () =>
      new Response("ok", { status: 200 })) as unknown as typeof fetch;
    const res = await guarded(fetchImpl)("https://allowed.example/metrics");
    expect(res.status).toBe(200);
  });

  it("re-validates the host on each redirect hop", async () => {
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("allowed.example")) {
        return new Response(null, {
          status: 302,
          headers: { location: "https://blocked.example/inner" },
        });
      }
      return new Response("should not reach", { status: 200 });
    }) as unknown as typeof fetch;
    await expect(
      guarded(fetchImpl)("https://allowed.example/start"),
    ).rejects.toBeInstanceOf(GuardedFetchError);
  });

  it("follows a redirect to another allowed host", async () => {
    let hops = 0;
    const fetchImpl = (async (input: RequestInfo | URL) => {
      hops += 1;
      const url = String(input);
      if (url.endsWith("/start")) {
        return new Response(null, {
          status: 302,
          headers: { location: "https://allowed.example/final" },
        });
      }
      return new Response("done", { status: 200 });
    }) as unknown as typeof fetch;
    const res = await guarded(fetchImpl)("https://allowed.example/start");
    expect(res.status).toBe(200);
    expect(hops).toBe(2);
  });

  it("does not follow a redirect when maxRedirects is 0 (returns the 3xx as-is)", async () => {
    let hops = 0;
    const fetchImpl = (async () => {
      hops += 1;
      return new Response(null, {
        status: 302,
        headers: { location: "https://allowed.example/final" },
      });
    }) as unknown as typeof fetch;
    const res = await createGuardedFetch({
      logger: mockLogger(),
      lookupFn,
      fetchImpl,
      maxRedirects: 0,
    })("https://allowed.example/start");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://allowed.example/final");
    expect(hops).toBe(1);
  });

  it("downgrades a 303 to a GET and drops the body on the next hop", async () => {
    const seen: { method?: string; body: unknown }[] = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push({ method: init?.method, body: init?.body });
      const url = String(input);
      if (url.endsWith("/start")) {
        return new Response(null, {
          status: 303,
          headers: { location: "https://allowed.example/final" },
        });
      }
      return new Response("done", { status: 200 });
    }) as unknown as typeof fetch;

    const res = await guarded(fetchImpl)("https://allowed.example/start", {
      method: "POST",
      body: "payload",
      headers: { "content-type": "application/json" },
    });
    expect(res.status).toBe(200);
    // First hop keeps the POST + body; the post-303 hop is a bodyless GET.
    expect(seen[0]).toEqual({ method: "POST", body: "payload" });
    expect(seen[1]!.method).toBe("GET");
    expect(seen[1]!.body).toBeUndefined();
  });

  it("preserves method + string body across a 307 redirect", async () => {
    const seen: { method?: string; body: unknown }[] = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push({ method: init?.method, body: init?.body });
      const url = String(input);
      if (url.endsWith("/start")) {
        return new Response(null, {
          status: 307,
          headers: { location: "https://allowed.example/final" },
        });
      }
      return new Response("done", { status: 200 });
    }) as unknown as typeof fetch;

    const res = await guarded(fetchImpl)("https://allowed.example/start", {
      method: "POST",
      body: "payload",
    });
    expect(res.status).toBe(200);
    expect(seen[1]).toEqual({ method: "POST", body: "payload" });
  });

  it("fails clearly on a 307 whose body is a non-replayable stream", async () => {
    const fetchImpl = (async () =>
      new Response(null, {
        status: 307,
        headers: { location: "https://allowed.example/final" },
      })) as unknown as typeof fetch;

    // The mock never reads the body, so no `duplex` is needed - the guard
    // rejects the replay at the 307 hop before the stream is ever consumed.
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("chunk"));
        controller.close();
      },
    });
    await expect(
      guarded(fetchImpl)("https://allowed.example/start", {
        method: "POST",
        body: stream,
      }),
    ).rejects.toBeInstanceOf(GuardedFetchError);
  });

  describe("credential stripping across a redirect origin change", () => {
    /**
     * Redirect from `/start` to `redirectTo`, capturing the (normalized) headers
     * seen on every hop so a test can assert what was forwarded per hop.
     */
    function capturingRedirect(redirectTo: string) {
      const seen: Headers[] = [];
      const fetchImpl = (async (
        input: RequestInfo | URL,
        init?: RequestInit,
      ) => {
        seen.push(new Headers(init?.headers));
        const url = String(input);
        if (url.endsWith("/start")) {
          return new Response(null, {
            status: 307,
            headers: { location: redirectTo },
          });
        }
        return new Response("done", { status: 200 });
      }) as unknown as typeof fetch;
      return { fetchImpl, seen };
    }

    it("keeps Authorization on a SAME-origin redirect", async () => {
      const { fetchImpl, seen } = capturingRedirect(
        "https://allowed.example/final",
      );
      const res = await guarded(fetchImpl)("https://allowed.example/start", {
        headers: { authorization: "Bearer secret" },
      });
      expect(res.status).toBe(200);
      expect(seen[1]!.get("authorization")).toBe("Bearer secret");
    });

    it("strips Authorization when the redirect crosses to a DIFFERENT host", async () => {
      const { fetchImpl, seen } = capturingRedirect(
        "https://other.example/final",
      );
      const res = await guarded(fetchImpl)("https://allowed.example/start", {
        headers: { authorization: "Bearer secret" },
      });
      expect(res.status).toBe(200);
      expect(seen[0]!.get("authorization")).toBe("Bearer secret");
      expect(seen[1]!.get("authorization")).toBeNull();
    });

    it("strips credentials when only the PORT changes (still cross-origin)", async () => {
      const { fetchImpl, seen } = capturingRedirect(
        "https://allowed.example:8443/final",
      );
      const res = await guarded(fetchImpl)("https://allowed.example/start", {
        headers: {
          authorization: "Bearer secret",
          "proxy-authorization": "Basic zzz",
          cookie: "session=abc",
        },
      });
      expect(res.status).toBe(200);
      expect(seen[1]!.get("authorization")).toBeNull();
      expect(seen[1]!.get("proxy-authorization")).toBeNull();
      expect(seen[1]!.get("cookie")).toBeNull();
    });

    it("strips credentials for every init.headers container shape", async () => {
      const shapes: RequestInit["headers"][] = [
        new Headers({ authorization: "Bearer secret" }),
        [["authorization", "Bearer secret"]],
        { authorization: "Bearer secret" },
      ];
      for (const headers of shapes) {
        const { fetchImpl, seen } = capturingRedirect(
          "https://other.example/final",
        );
        const res = await guarded(fetchImpl)("https://allowed.example/start", {
          headers,
        });
        expect(res.status).toBe(200);
        expect(seen[1]!.get("authorization")).toBeNull();
      }
    });
  });

  it("gives up after too many redirects", async () => {
    const fetchImpl = (async () =>
      new Response(null, {
        status: 302,
        headers: { location: "https://allowed.example/loop" },
      })) as unknown as typeof fetch;
    await expect(
      createGuardedFetch({
        logger: mockLogger(),
        lookupFn,
        fetchImpl,
        maxRedirects: 2,
      })("https://allowed.example/loop"),
    ).rejects.toBeInstanceOf(GuardedFetchError);
  });
});
