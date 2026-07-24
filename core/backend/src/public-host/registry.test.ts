import { describe, expect, it, mock } from "bun:test";
import type { PluginMetadata } from "@checkstack/common";
import type { PublicHostMatch } from "@checkstack/backend-api";
import {
  createPublicHostRegistry,
  normalizeHost,
  resolveRequestHost,
} from "./registry";

const META: PluginMetadata = { pluginId: "test" } as PluginMetadata;

function match(slug: string): PublicHostMatch {
  return {
    pluginId: "statuspage",
    bootstrap: { kind: "status-page", slug },
    allowedApiPaths: ["/api/statuspage/getPublishedStatusPage"],
  };
}

describe("normalizeHost", () => {
  it("lowercases, trims, and strips the port", () => {
    expect(normalizeHost("  Status.ACME.com:443 ")).toBe("status.acme.com");
  });

  it("returns null for empty / missing / IPv6-literal hosts", () => {
    expect(normalizeHost(null)).toBeNull();
    expect(normalizeHost(undefined)).toBeNull();
    expect(normalizeHost("")).toBeNull();
    expect(normalizeHost("   ")).toBeNull();
    expect(normalizeHost("[::1]:3000")).toBeNull();
  });
});

describe("resolveRequestHost", () => {
  const from = (headers: Record<string, string>) =>
    resolveRequestHost((n) => headers[n.toLowerCase()]);

  it("prefers X-Forwarded-Host over the (rewritten) Host header", () => {
    // The reported bug: an edge proxy rewrites Host to the internal upstream and
    // forwards the browser host. Routing must use the forwarded host.
    expect(
      from({ host: "checkstack-web.internal.svc", "x-forwarded-host": "status.acme.com" }),
    ).toBe("status.acme.com");
  });

  it("uses the first hop of a comma-list X-Forwarded-Host", () => {
    expect(
      from({ host: "internal", "x-forwarded-host": "status.acme.com, edge-1" }),
    ).toBe("status.acme.com");
  });

  it("falls back to Host when there is no X-Forwarded-Host", () => {
    expect(from({ host: "Status.ACME.com:443" })).toBe("status.acme.com");
  });

  it("returns null when neither header is present", () => {
    expect(from({})).toBeNull();
  });
});

describe("createPublicHostRegistry", () => {
  it("returns the first matching resolver's result", async () => {
    const reg = createPublicHostRegistry();
    reg.extensionPoint.registerResolver(
      { resolve: async () => null },
      META,
    );
    reg.extensionPoint.registerResolver(
      { resolve: async (h) => (h === "status.acme.com" ? match("acme") : null) },
      META,
    );
    expect(await reg.resolve("status.acme.com")).toEqual(match("acme"));
    expect(await reg.resolve("other.com")).toBeNull();
  });

  it("caches hits so the resolver is not called twice within the TTL", async () => {
    let t = 1000;
    const resolve = mock(async () => match("acme"));
    const reg = createPublicHostRegistry({ ttlMs: 100, now: () => t });
    reg.extensionPoint.registerResolver({ resolve }, META);

    await reg.resolve("status.acme.com");
    await reg.resolve("status.acme.com");
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it("caches MISSES too (stray hosts cannot hammer the resolver)", async () => {
    let t = 1000;
    const resolve = mock(async () => null);
    const reg = createPublicHostRegistry({ ttlMs: 100, now: () => t });
    reg.extensionPoint.registerResolver({ resolve }, META);

    await reg.resolve("evil.example.com");
    await reg.resolve("evil.example.com");
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it("re-resolves once the TTL expires", async () => {
    let t = 1000;
    const resolve = mock(async () => match("acme"));
    const reg = createPublicHostRegistry({ ttlMs: 100, now: () => t });
    reg.extensionPoint.registerResolver({ resolve }, META);

    await reg.resolve("status.acme.com");
    t += 150;
    await reg.resolve("status.acme.com");
    expect(resolve).toHaveBeenCalledTimes(2);
  });

  it("single-flights concurrent lookups for the same host", async () => {
    const resolve = mock(
      () => new Promise<PublicHostMatch | null>((r) => setTimeout(() => r(match("acme")), 5)),
    );
    const reg = createPublicHostRegistry();
    reg.extensionPoint.registerResolver({ resolve }, META);

    const [a, b] = await Promise.all([
      reg.resolve("status.acme.com"),
      reg.resolve("status.acme.com"),
    ]);
    expect(a).toEqual(match("acme"));
    expect(b).toEqual(match("acme"));
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it("skips a throwing resolver and tries the next", async () => {
    const reg = createPublicHostRegistry();
    reg.extensionPoint.registerResolver(
      {
        resolve: async () => {
          throw new Error("boom");
        },
      },
      META,
    );
    reg.extensionPoint.registerResolver(
      { resolve: async () => match("acme") },
      META,
    );
    expect(await reg.resolve("status.acme.com")).toEqual(match("acme"));
  });

  it("bounds the cache: evicts the oldest entry past maxEntries", async () => {
    const resolve = mock(async (h: string) =>
      h === "a.com" ? match("a") : null,
    );
    const reg = createPublicHostRegistry({ ttlMs: 10_000, maxEntries: 2 });
    reg.extensionPoint.registerResolver({ resolve }, META);

    await reg.resolve("a.com"); // oldest
    await reg.resolve("b.com");
    await reg.resolve("c.com"); // evicts a.com
    await reg.resolve("a.com"); // a.com was evicted -> resolver runs again
    // a.com resolved twice (initial + after eviction); b/c once each.
    expect(resolve.mock.calls.filter((c) => c[0] === "a.com").length).toBe(2);
  });

  it("invalidate(host) forces a re-resolve for that host", async () => {
    let t = 1000;
    const resolve = mock(async () => match("acme"));
    const reg = createPublicHostRegistry({ ttlMs: 10_000, now: () => t });
    reg.extensionPoint.registerResolver({ resolve }, META);

    await reg.resolve("status.acme.com");
    reg.invalidate("status.acme.com");
    await reg.resolve("status.acme.com");
    expect(resolve).toHaveBeenCalledTimes(2);
  });
});
