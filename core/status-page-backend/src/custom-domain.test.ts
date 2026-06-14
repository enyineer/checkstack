import { describe, expect, it } from "bun:test";
import { verifyDomainTxt, reservedDomainReason } from "./custom-domain";

describe("reservedDomainReason", () => {
  it("accepts a normal public domain", () => {
    expect(
      reservedDomainReason({ domain: "status.acme.com", primaryHost: "app.acme.com" }),
    ).toBeNull();
  });

  it("rejects the platform's own host", () => {
    expect(
      reservedDomainReason({ domain: "app.acme.com", primaryHost: "app.acme.com" }),
    ).not.toBeNull();
  });

  it("rejects IP literals", () => {
    expect(
      reservedDomainReason({ domain: "10.0.0.1", primaryHost: null }),
    ).not.toBeNull();
  });

  it("rejects internal / non-public suffixes", () => {
    for (const d of [
      "svc.cluster.local",
      "foo.internal",
      "box.local",
      "host.localdomain",
    ]) {
      expect(reservedDomainReason({ domain: d, primaryHost: null })).not.toBeNull();
    }
  });
});

const NAME = "_checkstack-verify.status.acme.com";
const TOKEN = "tok_abc123";

describe("verifyDomainTxt", () => {
  it("verifies when a TXT record equals the token", async () => {
    const ok = await verifyDomainTxt({
      recordName: NAME,
      token: TOKEN,
      resolveTxt: async () => [["unrelated"], [TOKEN]],
    });
    expect(ok).toBe(true);
  });

  it("joins chunked TXT records before comparing", async () => {
    const ok = await verifyDomainTxt({
      recordName: NAME,
      token: "abcdef",
      resolveTxt: async () => [["abc", "def"]],
    });
    expect(ok).toBe(true);
  });

  it("fails when no record matches the token", async () => {
    const ok = await verifyDomainTxt({
      recordName: NAME,
      token: TOKEN,
      resolveTxt: async () => [["something-else"]],
    });
    expect(ok).toBe(false);
  });

  it("returns false (never throws) on a DNS error / NXDOMAIN", async () => {
    const ok = await verifyDomainTxt({
      recordName: NAME,
      token: TOKEN,
      resolveTxt: async () => {
        throw new Error("ENOTFOUND");
      },
    });
    expect(ok).toBe(false);
  });
});
