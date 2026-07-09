import { describe, expect, test } from "bun:test";
import type { PluginMetadata } from "@checkstack/common";
import type { PublicHostMatch } from "@checkstack/backend-api";
import { createPublicHostRegistry } from "./registry";
import { createCorsOriginResolver } from "./cors";

/**
 * Unit coverage for the dynamic CORS `origin` decision. This is the actual
 * cross-origin boundary: it must NEVER admit an arbitrary third-party origin,
 * and must admit ONLY the static allow-list plus configured custom domains.
 */

const PRIMARY = "admin.fake.test";
const PUBLIC = "status.fake.test";
const STATIC = ["https://admin.fake.test", "http://localhost:5173"];
const META = { pluginId: "statuspage" } as PluginMetadata;

const MATCH: PublicHostMatch = {
  pluginId: "statuspage",
  bootstrap: { kind: "status-page", slug: "acme" },
  allowedApiPaths: ["/api/statuspage/getPublishedStatusPage"],
};

function makeResolver() {
  const registry = createPublicHostRegistry();
  registry.extensionPoint.registerResolver(
    { resolve: async (host) => (host === PUBLIC ? MATCH : null) },
    META,
  );
  return createCorsOriginResolver({
    staticOrigins: STATIC,
    primaryHost: PRIMARY,
    registry,
  });
}

describe("createCorsOriginResolver", () => {
  test("admits each static allow-listed origin (echoes it, never '*')", async () => {
    const resolve = makeResolver();
    expect(await resolve("https://admin.fake.test")).toBe(
      "https://admin.fake.test",
    );
    expect(await resolve("http://localhost:5173")).toBe(
      "http://localhost:5173",
    );
  });

  test("admits a configured custom-domain origin (echoes exactly that origin)", async () => {
    const resolve = makeResolver();
    expect(await resolve("https://status.fake.test")).toBe(
      "https://status.fake.test",
    );
  });

  test("DENIES an arbitrary third-party origin", async () => {
    const resolve = makeResolver();
    expect(await resolve("https://evil.example")).toBeNull();
    expect(await resolve("https://status.fake.test.evil.example")).toBeNull();
  });

  test("DENIES an empty origin (same-origin / non-CORS requests carry none)", async () => {
    const resolve = makeResolver();
    expect(await resolve("")).toBeNull();
  });

  test("DENIES a malformed Origin header instead of throwing", async () => {
    const resolve = makeResolver();
    expect(await resolve("not a url")).toBeNull();
    expect(await resolve("http://")).toBeNull();
  });

  test("never returns the wildcard '*'", async () => {
    const resolve = makeResolver();
    for (const o of [
      "https://admin.fake.test",
      "https://status.fake.test",
      "https://evil.example",
      "*",
      "",
    ]) {
      expect(await resolve(o)).not.toBe("*");
    }
  });

  test("does not special-case a cross-origin request FROM the primary host by name", async () => {
    // An Origin equal to the primary host is only admitted via the static list
    // (its real BASE_URL origin), not by the registry short-circuit — the
    // resolver skips registry resolution for the primary host.
    const resolve = createCorsOriginResolver({
      staticOrigins: [],
      primaryHost: PRIMARY,
      registry: createPublicHostRegistry(),
    });
    expect(await resolve("https://admin.fake.test")).toBeNull();
  });
});
