import { describe, it, expect } from "bun:test";
import { validateWebhookUrl } from "./egress";

/** A lookup stub that always resolves a host to the given IP. */
function lookupTo(address: string, family = 4) {
  return () => Promise.resolve([{ address, family }]);
}

describe("validateWebhookUrl", () => {
  it("rejects a non-http(s) protocol", async () => {
    const result = await validateWebhookUrl({ url: "ftp://example.com/hook" });
    expect(result.ok).toBe(false);
  });

  it("rejects a malformed URL", async () => {
    const result = await validateWebhookUrl({ url: "not a url" });
    expect(result.ok).toBe(false);
  });

  it("rejects an IPv4 loopback literal", async () => {
    const result = await validateWebhookUrl({ url: "http://127.0.0.1/hook" });
    expect(result.ok).toBe(false);
  });

  it("rejects an IPv6 loopback literal", async () => {
    const result = await validateWebhookUrl({ url: "http://[::1]/hook" });
    expect(result.ok).toBe(false);
  });

  it("rejects the 0.0.0.0/8 'this host' alias", async () => {
    const result = await validateWebhookUrl({ url: "http://0.0.0.0/hook" });
    expect(result.ok).toBe(false);
  });

  it("rejects the cloud metadata endpoint", async () => {
    const result = await validateWebhookUrl({
      url: "http://169.254.169.254/latest/meta-data",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a link-local literal", async () => {
    const result = await validateWebhookUrl({ url: "http://169.254.1.1/hook" });
    expect(result.ok).toBe(false);
  });

  it("allows an RFC1918 literal (self-hosted internal receiver)", async () => {
    // Policy: internal RFC1918 hosts are legitimate self-hosted receivers.
    expect(
      (await validateWebhookUrl({ url: "http://10.0.0.5/hook" })).ok,
    ).toBe(true);
    expect(
      (await validateWebhookUrl({ url: "http://192.168.1.10/hook" })).ok,
    ).toBe(true);
    expect(
      (await validateWebhookUrl({ url: "http://172.16.4.4/hook" })).ok,
    ).toBe(true);
  });

  it("allows a hostname that resolves to an RFC1918 address", async () => {
    const result = await validateWebhookUrl({
      url: "https://gotify.internal.example.com/message",
      lookupFn: lookupTo("192.168.1.10"),
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a public hostname that resolves to loopback", async () => {
    const result = await validateWebhookUrl({
      url: "https://sneaky.example.com/hook",
      lookupFn: lookupTo("127.0.0.1"),
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a public hostname that resolves to the metadata endpoint", async () => {
    const result = await validateWebhookUrl({
      url: "https://sneaky.example.com/hook",
      lookupFn: lookupTo("169.254.169.254"),
    });
    expect(result.ok).toBe(false);
  });

  it("allows a public hostname that resolves to a public IP", async () => {
    const result = await validateWebhookUrl({
      url: "https://hooks.example.com/hook",
      lookupFn: lookupTo("93.184.216.34"),
    });
    expect(result.ok).toBe(true);
  });

  it("allows a public IPv4 literal", async () => {
    const result = await validateWebhookUrl({ url: "https://8.8.8.8/hook" });
    expect(result.ok).toBe(true);
  });
});
