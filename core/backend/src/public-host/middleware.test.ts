import { describe, expect, it, mock } from "bun:test";
import type { Context } from "hono";
import type { PublicHostMatch } from "@checkstack/backend-api";
import { createHostRoutingMiddleware } from "./middleware";

const MATCH: PublicHostMatch = {
  pluginId: "statuspage",
  bootstrap: { kind: "status-page", slug: "acme" },
  allowedApiPaths: ["/api/statuspage/getPublishedStatusPage"],
};

const registry = {
  resolve: async (host: string) =>
    host === "status.acme.com" ? MATCH : null,
};

/** Minimal Hono Context stub exposing only what the middleware touches. */
function fakeCtx(host: string | undefined, path: string) {
  let notFound = false;
  const c = {
    req: {
      header: (name: string) =>
        name.toLowerCase() === "host" ? host : undefined,
      path,
    },
    notFound: () => {
      notFound = true;
      return new Response("Not Found", { status: 404 });
    },
  } as unknown as Context;
  return { c, didNotFound: () => notFound };
}

async function run(host: string | undefined, path: string, primaryHost = "app.acme.com") {
  const mw = createHostRoutingMiddleware({ registry, primaryHost });
  const next = mock(async () => {});
  const { c, didNotFound } = fakeCtx(host, path);
  await mw(c, next);
  return { passed: next.mock.calls.length === 1, blocked: didNotFound() };
}

describe("createHostRoutingMiddleware", () => {
  it("passes through on the primary host without resolving", async () => {
    expect(await run("app.acme.com", "/api/statuspage/listStatusPages")).toEqual({
      passed: true,
      blocked: false,
    });
  });

  it("passes through on an unknown host (no regression)", async () => {
    expect(await run("random.example.com", "/api/catalog/getSystems")).toEqual({
      passed: true,
      blocked: false,
    });
  });

  it("404s a disallowed /api path on a matched public host", async () => {
    expect(await run("status.acme.com", "/api/statuspage/listStatusPages")).toEqual(
      { passed: false, blocked: true },
    );
    expect(await run("status.acme.com", "/api/catalog/getSystems")).toEqual({
      passed: false,
      blocked: true,
    });
  });

  it("allows the resolver's listed endpoint and /api/config on a matched host", async () => {
    expect(
      await run("status.acme.com", "/api/statuspage/getPublishedStatusPage"),
    ).toEqual({ passed: true, blocked: false });
    expect(await run("status.acme.com", "/api/config")).toEqual({
      passed: true,
      blocked: false,
    });
  });

  it("allows navigational/asset requests (SPA + bundle assets) on a matched host", async () => {
    expect(await run("status.acme.com", "/")).toEqual({
      passed: true,
      blocked: false,
    });
    expect(await run("status.acme.com", "/assets/public-app.js")).toEqual({
      passed: true,
      blocked: false,
    });
  });

  it("404s platform/docs/rest endpoints on a matched host", async () => {
    for (const path of ["/rest/x", "/checkstack/guide", "/.checkstack/ready"]) {
      expect(await run("status.acme.com", path)).toEqual({
        passed: false,
        blocked: true,
      });
    }
  });
});
