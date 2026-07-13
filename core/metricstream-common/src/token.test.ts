import { describe, it, expect } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  isMetricstreamToken,
  shortStreamId,
  extractIngestToken,
} from "./token";

// generateToken / hashToken (node:crypto) live in @checkstack/ingest-utils'
// source-token kit (backend-only) - see the browser-safety guard below.

describe("shortStreamId", () => {
  it("strips non-alphanumerics and truncates to 8", () => {
    expect(shortStreamId("stream_ab-cd.ef_gh")).toBe("streamab");
    expect(shortStreamId("x")).toBe("x");
  });
});

describe("isMetricstreamToken", () => {
  it("matches only ckms_ values", () => {
    expect(isMetricstreamToken("ckms_abc")).toBe(true);
    expect(isMetricstreamToken("ckls_abc")).toBe(false);
    expect(isMetricstreamToken("ck_abc")).toBe(false);
    expect(isMetricstreamToken("bearer ckms_abc")).toBe(false);
  });
});

describe("extractIngestToken", () => {
  it("reads a Bearer token", () => {
    expect(
      extractIngestToken({ authorization: "Bearer ckms_abc123" }),
    ).toBe("ckms_abc123");
  });

  it("is case-insensitive on the scheme", () => {
    expect(extractIngestToken({ authorization: "bearer ckms_abc" })).toBe(
      "ckms_abc",
    );
  });

  it("reads the X-Checkstack-Token header", () => {
    expect(extractIngestToken({ checkstackToken: "ckms_headertoken" })).toBe(
      "ckms_headertoken",
    );
  });

  it("prefers the explicit token header over Authorization", () => {
    expect(
      extractIngestToken({
        authorization: "Bearer ckms_fromauth",
        checkstackToken: "ckms_fromheader",
      }),
    ).toBe("ckms_fromheader");
  });

  it("rejects non-metricstream tokens and missing values", () => {
    expect(extractIngestToken({ authorization: "Bearer ckls_app_key" })).toBeNull();
    expect(extractIngestToken({})).toBeNull();
    expect(extractIngestToken({ authorization: "" })).toBeNull();
  });
});

describe("browser-safety guard", () => {
  // REGRESSION (from logstream): a top-level `node:crypto` import in a common
  // package made Vite externalize the module and the ENTIRE frontend plugin
  // failed to load in the browser - no nav entry, no routes, no check-editor
  // dropdown resolvers. This package ships to the browser: no source file may
  // import a node builtin. (Test files are exempt; they never ship.)
  it("no shipped source file imports a node builtin", () => {
    const offenders: string[] = [];
    walkForNodeImports(import.meta.dir, offenders);
    expect(offenders).toEqual([]);
  });
});

/** Recursively collect shipped `.ts` files that import a `node:` builtin. */
function walkForNodeImports(dir: string, offenders: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkForNodeImports(full, offenders);
      continue;
    }
    if (!entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) continue;
    const content = readFileSync(full, "utf8");
    if (/from\s+["']node:|require\(["']node:/.test(content)) {
      offenders.push(full);
    }
  }
}
