import { describe, expect, it } from "bun:test";
import { classifyPublicHostRequest, isBlocked } from "./routing";

const ALLOWED = ["/api/statuspage/getPublishedStatusPage"];

function classify(path: string) {
  return classifyPublicHostRequest({ path, allowedApiPaths: ALLOWED });
}

describe("classifyPublicHostRequest", () => {
  it("allows /api/config (bundle bootstrap) regardless of the resolver list", () => {
    expect(classify("/api/config")).toBe("api-allowed");
    expect(
      classifyPublicHostRequest({ path: "/api/config", allowedApiPaths: [] }),
    ).toBe("api-allowed");
  });

  it("allows exactly the resolver's listed API paths", () => {
    expect(classify("/api/statuspage/getPublishedStatusPage")).toBe(
      "api-allowed",
    );
  });

  it("blocks every other /api path (admin data is unreachable)", () => {
    expect(classify("/api/statuspage/listStatusPages")).toBe("api-blocked");
    expect(classify("/api/catalog/getSystems")).toBe("api-blocked");
    expect(classify("/api/plugins")).toBe("api-blocked");
    expect(classify("/api/about")).toBe("api-blocked");
  });

  it("blocks all REST and admin-docs paths", () => {
    expect(classify("/rest/anything")).toBe("rest-blocked");
    expect(classify("/checkstack")).toBe("docs-blocked");
    expect(classify("/checkstack/user-guide/")).toBe("docs-blocked");
  });

  it("blocks platform + well-known endpoints (readiness, jwks) — no info disclosure", () => {
    expect(classify("/.checkstack/ready")).toBe("platform-blocked");
    expect(classify("/.checkstack/health")).toBe("platform-blocked");
    expect(classify("/.well-known/jwks.json")).toBe("platform-blocked");
  });

  it("keeps ONLY the on-demand-TLS hook reachable among well-known paths", () => {
    expect(classify("/.well-known/checkstack/authorize-domain")).toBe(
      "navigational",
    );
  });

  it("treats assets and SPA navigation as navigational", () => {
    expect(classify("/")).toBe("navigational");
    expect(classify("/assets/index-abc.js")).toBe("navigational");
    expect(classify("/vendor/react.js")).toBe("navigational");
    expect(classify("/favicon.svg")).toBe("navigational");
    expect(classify("/some/deep/spa/route")).toBe("navigational");
  });

  it("isBlocked is true only for the blocked kinds", () => {
    expect(isBlocked("api-blocked")).toBe(true);
    expect(isBlocked("rest-blocked")).toBe(true);
    expect(isBlocked("docs-blocked")).toBe(true);
    expect(isBlocked("platform-blocked")).toBe(true);
    expect(isBlocked("api-allowed")).toBe(false);
    expect(isBlocked("navigational")).toBe(false);
  });
});
