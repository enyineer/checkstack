import { describe, it, expect, afterEach } from "bun:test";
import { readBootstrap, BOOTSTRAP_GLOBAL } from "./bootstrap";

const g = globalThis as Record<string, unknown>;

afterEach(() => {
  delete g[BOOTSTRAP_GLOBAL];
});

describe("readBootstrap", () => {
  it("returns undefined when no blob is inlined (dev server)", () => {
    expect(readBootstrap()).toBeUndefined();
  });

  it("returns the parsed blob when present and well-formed", () => {
    g[BOOTSTRAP_GLOBAL] = {
      config: { baseUrl: "https://app.example.com" },
      enabledPlugins: [{ name: "@acme/widget-frontend", path: "/dist" }],
    };
    expect(readBootstrap()).toEqual({
      config: { baseUrl: "https://app.example.com" },
      enabledPlugins: [{ name: "@acme/widget-frontend", path: "/dist" }],
    });
  });

  it("carries the publicHost hint through for the public bundle", () => {
    g[BOOTSTRAP_GLOBAL] = {
      config: {
        baseUrl: "https://status.acme.com",
        publicHost: { kind: "status-page", slug: "acme" },
      },
      enabledPlugins: [],
    };
    expect(readBootstrap()?.config.publicHost).toEqual({
      kind: "status-page",
      slug: "acme",
    });
  });

  it("returns undefined for a malformed blob (missing baseUrl)", () => {
    g[BOOTSTRAP_GLOBAL] = { config: {}, enabledPlugins: [] };
    expect(readBootstrap()).toBeUndefined();
  });

  it("returns undefined when enabledPlugins is not an array", () => {
    g[BOOTSTRAP_GLOBAL] = {
      config: { baseUrl: "x" },
      enabledPlugins: "nope",
    };
    expect(readBootstrap()).toBeUndefined();
  });
});
