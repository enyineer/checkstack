import { describe, expect, test } from "bun:test";
import { isPrivateIp, parseSafeProbeUrl } from "./ssrf-guard";

describe("isPrivateIp", () => {
  test("blocks private/reserved IPv4 ranges", () => {
    for (const ip of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254", // cloud metadata
      "100.64.0.1", // CGNAT
      "0.0.0.0",
      "224.0.0.1", // multicast
    ]) {
      expect(isPrivateIp(ip)).toBe(true);
    }
  });

  test("allows public IPv4", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.216.34"]) {
      expect(isPrivateIp(ip)).toBe(false);
    }
  });

  test("blocks private/reserved IPv6 incl. IPv4-mapped private", () => {
    for (const ip of ["::1", "::", "fe80::1", "fc00::1", "fd12::3", "::ffff:127.0.0.1"]) {
      expect(isPrivateIp(ip)).toBe(true);
    }
  });

  test("allows public IPv6", () => {
    expect(isPrivateIp("2606:4700:4700::1111")).toBe(false);
  });
});

describe("parseSafeProbeUrl", () => {
  test("accepts a public http(s) URL", () => {
    const safe = parseSafeProbeUrl("https://example.com/status");
    expect(safe.hostname).toBe("example.com");
    expect(safe.url.pathname).toBe("/status");
  });

  test("rejects non-http(s) schemes", () => {
    expect(() => parseSafeProbeUrl("file:///etc/passwd")).toThrow(/http and https/);
    expect(() => parseSafeProbeUrl("ftp://example.com")).toThrow(/http and https/);
  });

  test("rejects malformed URLs", () => {
    expect(() => parseSafeProbeUrl("not a url")).toThrow(/Invalid URL/);
  });

  test("rejects loopback + internal hostnames", () => {
    expect(() => parseSafeProbeUrl("http://localhost:8080/")).toThrow(/loopback/);
    expect(() => parseSafeProbeUrl("http://foo.localhost/")).toThrow(/loopback/);
    expect(() =>
      parseSafeProbeUrl("http://metadata.google.internal/"),
    ).toThrow(/loopback|internal/);
  });

  test("rejects private IP literals (v4 + v6)", () => {
    expect(() => parseSafeProbeUrl("http://169.254.169.254/latest/meta-data")).toThrow(
      /private\/reserved/,
    );
    expect(() => parseSafeProbeUrl("http://10.0.0.5/")).toThrow(/private\/reserved/);
    expect(() => parseSafeProbeUrl("http://[::1]:9000/")).toThrow(/private\/reserved/);
  });
});
