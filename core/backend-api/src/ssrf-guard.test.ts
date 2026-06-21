import { describe, it, expect } from "bun:test";
import {
  parseCidr,
  ipInCidr,
  findBlockingCidr,
  resolveAndValidateHost,
  pinUrlToIp,
  SsrfBlockedError,
  DEFAULT_EGRESS_DENY_CIDRS,
} from "./ssrf-guard";

describe("CIDR matching", () => {
  it("matches IPv4 addresses inside a range", () => {
    const cidr = parseCidr("169.254.0.0/16")!;
    expect(cidr).not.toBeNull();
    expect(ipInCidr("169.254.169.254", cidr)).toBe(true);
    expect(ipInCidr("169.254.0.1", cidr)).toBe(true);
    expect(ipInCidr("10.0.0.1", cidr)).toBe(false);
    expect(ipInCidr("8.8.8.8", cidr)).toBe(false);
  });

  it("matches IPv6 addresses inside a range", () => {
    const fc00 = parseCidr("fc00::/7")!;
    // fd00:ec2::254 (IPv6 IMDS alias) falls inside fc00::/7.
    expect(ipInCidr("fd00:ec2::254", fc00)).toBe(true);
    expect(ipInCidr("2001:4860:4860::8888", fc00)).toBe(false);

    const fe80 = parseCidr("fe80::/10")!;
    expect(ipInCidr("fe80::1", fe80)).toBe(true);
    expect(ipInCidr("2001:db8::1", fe80)).toBe(false);
  });

  it("does not cross IP versions", () => {
    const v4 = parseCidr("0.0.0.0/0")!;
    expect(ipInCidr("::1", v4)).toBe(false);
  });

  it("rejects malformed CIDRs", () => {
    expect(parseCidr("not-a-cidr")).toBeNull();
    expect(parseCidr("10.0.0.0/99")).toBeNull();
    expect(parseCidr("999.0.0.0/8")).toBeNull();
  });

  it("findBlockingCidr returns the first matching denied range", () => {
    expect(
      findBlockingCidr("169.254.169.254", DEFAULT_EGRESS_DENY_CIDRS),
    ).toBe("169.254.0.0/16");
    expect(findBlockingCidr("8.8.8.8", DEFAULT_EGRESS_DENY_CIDRS)).toBeNull();
    // RFC1918 is NOT in the default denylist (internal probing stays allowed).
    expect(findBlockingCidr("10.1.2.3", DEFAULT_EGRESS_DENY_CIDRS)).toBeNull();
    expect(
      findBlockingCidr("192.168.1.1", DEFAULT_EGRESS_DENY_CIDRS),
    ).toBeNull();
  });
});

describe("resolveAndValidateHost", () => {
  it("rejects a bare metadata IP literal", async () => {
    await expect(
      resolveAndValidateHost({ host: "169.254.169.254" }),
    ).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it("allows a bare RFC1918 IP literal (internal probing stays allowed)", async () => {
    const target = await resolveAndValidateHost({ host: "10.0.0.5" });
    expect(target.ip).toBe("10.0.0.5");
    expect(target.family).toBe(4);
  });

  it("rejects a hostname that resolves to the metadata IP (DNS-based SSRF)", async () => {
    await expect(
      resolveAndValidateHost({
        host: "evil.example.com",
        lookupFn: async () => [{ address: "169.254.169.254", family: 4 }],
      }),
    ).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it("rejects when ANY resolved address is denied (rebind/confusion guard)", async () => {
    await expect(
      resolveAndValidateHost({
        host: "mixed.example.com",
        lookupFn: async () => [
          { address: "93.184.216.34", family: 4 },
          { address: "169.254.169.254", family: 4 },
        ],
      }),
    ).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it("returns the resolved IP to pin to for an allowed host", async () => {
    const target = await resolveAndValidateHost({
      host: "good.example.com",
      lookupFn: async () => [{ address: "93.184.216.34", family: 4 }],
    });
    expect(target.ip).toBe("93.184.216.34");
    expect(target.host).toBe("good.example.com");
  });

  it("honors operator-extended denylist (e.g. blocking an internal range)", async () => {
    await expect(
      resolveAndValidateHost({
        host: "internal.example.com",
        denyCidrs: [...DEFAULT_EGRESS_DENY_CIDRS, "10.0.0.0/8"],
        lookupFn: async () => [{ address: "10.5.5.5", family: 4 }],
      }),
    ).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it("strips IPv6 brackets and rejects a bracketed link-local literal", async () => {
    await expect(
      resolveAndValidateHost({ host: "[fe80::1]" }),
    ).rejects.toBeInstanceOf(SsrfBlockedError);
  });
});

describe("pinUrlToIp", () => {
  it("rewrites the host to the IP, preserving path/query/port", () => {
    expect(pinUrlToIp("https://example.com/healthz?x=1", "93.184.216.34")).toBe(
      "https://93.184.216.34/healthz?x=1",
    );
    expect(pinUrlToIp("http://example.com:8080/a", "10.0.0.1")).toBe(
      "http://10.0.0.1:8080/a",
    );
  });

  it("brackets IPv6 literals", () => {
    expect(pinUrlToIp("https://example.com/x", "2606:2800:220::1")).toBe(
      "https://[2606:2800:220::1]/x",
    );
  });
});
