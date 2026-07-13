import { describe, it, expect } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  isLogstreamToken,
  shortStreamId,
  extractIngestToken,
} from "./token";

// generateToken / hashToken (node:crypto) moved to
// logstream-backend/src/token-crypto.ts - see the browser-safety guard below.

describe("shortStreamId", () => {
  it("strips non-alphanumerics and truncates to 8", () => {
    expect(shortStreamId("stream_ab-cd.ef_gh")).toBe("streamab");
    expect(shortStreamId("x")).toBe("x");
  });
});

describe("isLogstreamToken", () => {
  it("matches only ckls_ values", () => {
    expect(isLogstreamToken("ckls_abc")).toBe(true);
    expect(isLogstreamToken("ck_abc")).toBe(false);
    expect(isLogstreamToken("bearer ckls_abc")).toBe(false);
  });
});

describe("extractIngestToken", () => {
  it("reads a Bearer token", () => {
    expect(
      extractIngestToken({ authorization: "Bearer ckls_abc123" }),
    ).toBe("ckls_abc123");
  });

  it("is case-insensitive on the scheme", () => {
    expect(
      extractIngestToken({ authorization: "bearer ckls_abc" }),
    ).toBe("ckls_abc");
  });

  it("reads the X-Checkstack-Token header", () => {
    expect(
      extractIngestToken({ checkstackToken: "ckls_headertoken" }),
    ).toBe("ckls_headertoken");
  });

  it("prefers the explicit token header over Authorization", () => {
    expect(
      extractIngestToken({
        authorization: "Bearer ckls_fromauth",
        checkstackToken: "ckls_fromheader",
      }),
    ).toBe("ckls_fromheader");
  });

  it("rejects non-logstream tokens and missing values", () => {
    expect(extractIngestToken({ authorization: "Bearer ck_app_key" })).toBeNull();
    expect(extractIngestToken({})).toBeNull();
    expect(extractIngestToken({ authorization: "" })).toBeNull();
  });
});

describe("browser-safety guard", () => {
  // REGRESSION: a top-level `node:crypto` import in this package made Vite
  // externalize the module and the ENTIRE logstream frontend plugin failed to
  // load in the browser - no nav entry, no routes, no check-editor dropdown
  // resolvers. This package ships to the browser: no source file may import a
  // node builtin. (Test files are exempt; they never ship.)
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
