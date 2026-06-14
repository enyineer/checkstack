import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import type { PluginMetadata } from "@checkstack/common";
import type { PublicHostMatch } from "@checkstack/backend-api";
import { createPublicHostRegistry, normalizeHost } from "./registry";
import { createHostRoutingMiddleware } from "./middleware";

/**
 * E2E for custom-domain host routing over REAL HTTP.
 *
 * A real `Bun.serve` mounts the REAL `createHostRoutingMiddleware` + the REAL
 * `createPublicHostRegistry` plus handlers mirroring the platform's allow-listed
 * endpoints. Requests are made with `fetch` and an overridden `Host` header to
 * simulate "opening that URL" on a custom domain (`status.fake.test`) vs the
 * admin host (`admin.fake.test`), asserting that only the public surface is
 * reachable on the custom domain.
 */

const PRIMARY = "admin.fake.test";
const PUBLIC = "status.fake.test";
const PUBLIC_READ = "/api/statuspage/getPublishedStatusPage";
const META = { pluginId: "statuspage" } as PluginMetadata; // resolver ignores it

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

  // Mirrors core/backend's matchPublicHost: primary/unknown hosts -> null.
  const match = (c: { req: { header(n: string): string | undefined } }) => {
    const host = normalizeHost(c.req.header("host"));
    if (!host || host === PRIMARY) return Promise.resolve(null);
    return registry.resolve(host);
  };

  const app = new Hono();
  app.use(
    "*",
    createHostRoutingMiddleware({ registry, primaryHost: PRIMARY }),
  );

  // Host-aware config: on a public host returns the request's own origin (never
  // the admin origin) plus the bootstrap hint.
  app.get("/api/config", async (c) => {
    const m = await match(c);
    if (m) {
      return c.json({ baseUrl: `https://${c.req.header("host")}`, publicHost: m.bootstrap });
    }
    return c.json({ baseUrl: `https://${PRIMARY}` });
  });

  // The single allow-listed public read.
  app.post(PUBLIC_READ, (c) => c.json({ slug: "acme", title: "Acme", blocks: [] }));
  // An admin data endpoint that MUST be blocked on a public host.
  app.get("/api/statuspage/listStatusPages", (c) => c.json({ pages: ["secret"] }));

  // SPA fallback: the public bundle on a public host, the admin bundle otherwise.
  app.get("*", async (c) => c.text((await match(c)) ? "PUBLIC_BUNDLE" : "ADMIN_BUNDLE"));

  server = Bun.serve({ port: 0, fetch: app.fetch });
  base = `http://127.0.0.1:${server.port}`;
});

afterAll(() => server.stop(true));

/** fetch with an overridden Host header (Bun permits this). */
function get(path: string, host: string, init?: RequestInit) {
  return fetch(`${base}${path}`, { ...init, headers: { host, ...init?.headers } });
}

describe("custom-domain host (status.fake.test) — locked down", () => {
  test("404s an admin data endpoint", async () => {
    expect((await get("/api/statuspage/listStatusPages", PUBLIC)).status).toBe(404);
  });

  test("404s REST and platform endpoints", async () => {
    expect((await get("/rest/anything", PUBLIC)).status).toBe(404);
    expect((await get("/.checkstack/ready", PUBLIC)).status).toBe(404);
  });

  test("allows the single public read", async () => {
    const res = await get(PUBLIC_READ, PUBLIC, { method: "POST" });
    expect(res.status).toBe(200);
    expect((await res.json()).slug).toBe("acme");
  });

  test("/api/config returns the custom origin + publicHost (never the admin origin)", async () => {
    const cfg = await (await get("/api/config", PUBLIC)).json();
    expect(cfg.publicHost).toEqual({ kind: "status-page", slug: "acme" });
    expect(cfg.baseUrl).toBe(`https://${PUBLIC}`);
  });

  test("serves the PUBLIC bundle for navigational routes", async () => {
    expect(await (await get("/", PUBLIC)).text()).toBe("PUBLIC_BUNDLE");
    expect(await (await get("/some/deep/route", PUBLIC)).text()).toBe("PUBLIC_BUNDLE");
  });
});

describe("admin host (admin.fake.test) — unaffected", () => {
  test("admin data endpoint is reachable", async () => {
    expect((await get("/api/statuspage/listStatusPages", PRIMARY)).status).toBe(200);
  });

  test("serves the ADMIN bundle and admin config", async () => {
    expect(await (await get("/", PRIMARY)).text()).toBe("ADMIN_BUNDLE");
    const cfg = await (await get("/api/config", PRIMARY)).json();
    expect(cfg.publicHost).toBeUndefined();
    expect(cfg.baseUrl).toBe(`https://${PRIMARY}`);
  });
});

describe("unknown host — no regression (admin behavior)", () => {
  test("is not locked down", async () => {
    expect((await get("/api/statuspage/listStatusPages", "random.example.com")).status).toBe(200);
    expect(await (await get("/", "random.example.com")).text()).toBe("ADMIN_BUNDLE");
  });
});
