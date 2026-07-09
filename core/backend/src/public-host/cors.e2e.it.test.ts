import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { PluginMetadata } from "@checkstack/common";
import type { PublicHostMatch } from "@checkstack/backend-api";
import { createPublicHostRegistry, normalizeHost } from "./registry";
import { createHostRoutingMiddleware } from "./middleware";
import { createCorsOriginResolver } from "./cors";

/**
 * E2E for cross-origin / CORS safety of the custom-domain public surface over
 * REAL HTTP. A real `Bun.serve` mounts the REAL `hono/cors` middleware wired to
 * the REAL {@link createCorsOriginResolver} decision plus the REAL
 * host-routing lockdown, exactly as `core/backend/src/index.ts` does. Requests
 * carry overridden `Host` and `Origin` headers so we can assert what
 * `Access-Control-*` a browser would actually be handed.
 *
 * The guarantee under test: the custom-domain public API never hands a
 * permissive/reflected ACAO to a third-party origin, and never emits the
 * wildcard `*` (which would combine unsafely with `credentials: true`). Only
 * the admin origin and CONFIGURED custom domains are admitted, cross-origin
 * reads with credentials are otherwise impossible.
 *
 * Gated on CHECKSTACK_IT (real-HTTP integration test).
 */

const PRIMARY = "admin.fake.test";
const PRIMARY_ORIGIN = `https://${PRIMARY}`;
const PUBLIC = "status.fake.test";
const PUBLIC_ORIGIN = `https://${PUBLIC}`;
const EVIL_ORIGIN = "https://evil.example";
const PUBLIC_READ = "/api/statuspage/getPublishedStatusPage";
const META = { pluginId: "statuspage" } as PluginMetadata;

const MATCH: PublicHostMatch = {
  pluginId: "statuspage",
  bootstrap: { kind: "status-page", slug: "acme" },
  allowedApiPaths: [PUBLIC_READ],
};

let server: ReturnType<typeof Bun.serve>;
let base: string;

beforeAll(() => {
  const registry = createPublicHostRegistry();
  registry.extensionPoint.registerResolver(
    { resolve: async (host) => (host === PUBLIC ? MATCH : null) },
    META,
  );

  // Mirror index.ts: static allow-list (admin BASE_URL + Vite dev origin).
  const resolveCorsOrigin = createCorsOriginResolver({
    staticOrigins: [PRIMARY_ORIGIN, "http://localhost:5173"],
    primaryHost: PRIMARY,
    registry,
  });

  const match = (c: { req: { header(n: string): string | undefined } }) => {
    const host = normalizeHost(c.req.header("host"));
    if (!host || host === PRIMARY) return Promise.resolve(null);
    return registry.resolve(host);
  };

  const app = new Hono();

  // Same ordering & options as core/backend/src/index.ts: cors first, then the
  // host-routing lockdown.
  app.use(
    "*",
    cors({
      origin: (origin) => resolveCorsOrigin(origin),
      allowHeaders: ["Content-Type", "Authorization"],
      allowMethods: ["POST", "GET", "PUT", "PATCH", "DELETE", "OPTIONS"],
      exposeHeaders: ["Content-Length"],
      maxAge: 600,
      credentials: true,
    }),
  );
  app.use(
    "*",
    createHostRoutingMiddleware({ registry, primaryHost: PRIMARY }),
  );

  app.get("/api/config", async (c) => {
    const m = await match(c);
    if (m) {
      return c.json({
        baseUrl: `https://${c.req.header("host")}`,
        publicHost: m.bootstrap,
      });
    }
    return c.json({ baseUrl: PRIMARY_ORIGIN });
  });

  app.post(PUBLIC_READ, (c) => c.json({ slug: "acme", title: "Acme", blocks: [] }));
  app.get("/api/statuspage/listStatusPages", (c) => c.json({ pages: ["secret"] }));

  server = Bun.serve({ port: 0, fetch: app.fetch });
  base = `http://127.0.0.1:${server.port}`;
});

afterAll(() => server.stop(true));

function req(
  path: string,
  { host, origin, method }: { host: string; origin?: string; method?: string },
) {
  const headers: Record<string, string> = { host };
  if (origin) headers.origin = origin;
  return fetch(`${base}${path}`, { method: method ?? "GET", headers });
}

/** Assert no response in this suite ever advertises the wildcard ACAO. */
function expectNoWildcard(res: Response) {
  expect(res.headers.get("access-control-allow-origin")).not.toBe("*");
}

describe("custom-domain public API — CORS is not cross-origin exploitable", () => {
  test("a third-party Origin gets NO Access-Control-Allow-Origin (denied)", async () => {
    const res = await req(PUBLIC_READ, {
      host: PUBLIC,
      origin: EVIL_ORIGIN,
      method: "POST",
    });
    // The read itself is public (no cookies needed), but the browser is told
    // NOT to expose the response to evil.example: no ACAO for that origin.
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expectNoWildcard(res);
  });

  test("ACAO is NEVER the wildcard '*' (so credentials:true cannot be abused)", async () => {
    for (const origin of [EVIL_ORIGIN, PUBLIC_ORIGIN, PRIMARY_ORIGIN, undefined]) {
      const res = await req(PUBLIC_READ, { host: PUBLIC, origin, method: "POST" });
      expectNoWildcard(res);
    }
  });

  test("a configured custom-domain Origin is echoed back exactly (not reflected blindly)", async () => {
    const res = await req(PUBLIC_READ, {
      host: PUBLIC,
      origin: PUBLIC_ORIGIN,
      method: "POST",
    });
    expect(res.headers.get("access-control-allow-origin")).toBe(PUBLIC_ORIGIN);
    // Vary: Origin must be present so caches never serve one origin's ACAO to
    // another.
    expect((res.headers.get("vary") ?? "").toLowerCase()).toContain("origin");
  });

  test("a look-alike subdomain of a configured domain is DENIED", async () => {
    const res = await req(PUBLIC_READ, {
      host: PUBLIC,
      origin: "https://status.fake.test.evil.example",
      method: "POST",
    });
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expectNoWildcard(res);
  });

  test("CORS preflight (OPTIONS) from a third-party origin gets no ACAO", async () => {
    const res = await fetch(`${base}${PUBLIC_READ}`, {
      method: "OPTIONS",
      headers: {
        host: PUBLIC,
        origin: EVIL_ORIGIN,
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type",
      },
    });
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expectNoWildcard(res);
  });

  test("CORS preflight from the configured domain is handled safely (echo + Vary, no '*')", async () => {
    const res = await fetch(`${base}${PUBLIC_READ}`, {
      method: "OPTIONS",
      headers: {
        host: PUBLIC,
        origin: PUBLIC_ORIGIN,
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type",
      },
    });
    expect(res.headers.get("access-control-allow-origin")).toBe(PUBLIC_ORIGIN);
    expectNoWildcard(res);
  });
});

describe("custom-domain host — data isolation still holds with CORS in front", () => {
  test("admin data endpoint is 404'd on the custom-domain host", async () => {
    const res = await req("/api/statuspage/listStatusPages", { host: PUBLIC });
    expect(res.status).toBe(404);
  });

  test("REST and platform endpoints are 404'd on the custom-domain host", async () => {
    expect((await req("/rest/anything", { host: PUBLIC })).status).toBe(404);
    expect((await req("/.checkstack/ready", { host: PUBLIC })).status).toBe(404);
  });

  test("the single allow-listed public read works", async () => {
    const res = await req(PUBLIC_READ, { host: PUBLIC, method: "POST" });
    expect(res.status).toBe(200);
    expect((await res.json()).slug).toBe("acme");
  });

  test("/api/config returns the custom origin + publicHost hint, no admin leak", async () => {
    const res = await req("/api/config", { host: PUBLIC });
    expect(res.status).toBe(200);
    const cfg = await res.json();
    expect(cfg.baseUrl).toBe(PUBLIC_ORIGIN);
    expect(cfg.publicHost).toEqual({ kind: "status-page", slug: "acme" });
    // No admin-only fields leak to the public origin.
    expect(cfg.publicPathPrefixes).toBeUndefined();
    expect(cfg.instanceNamespace).toBeUndefined();
  });
});

describe("admin origin — unaffected by the custom-domain CORS additions", () => {
  test("the admin BASE_URL origin is still admitted on the admin host", async () => {
    const res = await req("/api/statuspage/listStatusPages", {
      host: PRIMARY,
      origin: PRIMARY_ORIGIN,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe(PRIMARY_ORIGIN);
    expectNoWildcard(res);
  });

  test("a third-party Origin is denied on the admin host too", async () => {
    const res = await req("/api/statuspage/listStatusPages", {
      host: PRIMARY,
      origin: EVIL_ORIGIN,
    });
    // Endpoint responds (admin host is not locked down), but the browser is not
    // allowed to read it cross-origin: no ACAO for evil.
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expectNoWildcard(res);
  });
});
