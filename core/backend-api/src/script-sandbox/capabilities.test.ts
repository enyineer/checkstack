import { describe, expect, it } from "bun:test";
import {
  __resetCapabilitiesCacheForTest,
  detectSandboxCapabilities,
} from "./capabilities";

describe("detectSandboxCapabilities", () => {
  it("returns a deterministic, well-formed shape on the current host", () => {
    __resetCapabilitiesCacheForTest();
    const caps = detectSandboxCapabilities();

    expect(["linux", "darwin", "other"]).toContain(caps.platform);
    expect(typeof caps.euidIsRoot).toBe("boolean");
    expect(typeof caps.hasPrlimit).toBe("boolean");
    expect(typeof caps.rlimitNative).toBe("boolean");
    expect([null, "bwrap", "nsjail", "firejail"]).toContain(caps.wrapper);
    expect(typeof caps.userNamespaces).toBe("boolean");
    expect(typeof caps.netNamespaces).toBe("boolean");
    expect(
      caps.netEgressIface === null || typeof caps.netEgressIface === "string",
    ).toBe(true);
    expect(typeof caps.netEgressRootless).toBe("boolean");
  });

  it("only claims rootless egress on a bwrap host with usable user namespaces", () => {
    __resetCapabilitiesCacheForTest();
    const caps = detectSandboxCapabilities();
    // netEgressRootless is delivered ONLY via bwrap (the only wrapper that
    // exposes the child PID for a race-free slirp4netns attach here) and needs
    // unprivileged user namespaces. Never claim it otherwise.
    if (caps.netEgressRootless) {
      expect(caps.platform).toBe("linux");
      expect(caps.wrapper).toBe("bwrap");
      expect(caps.userNamespaces).toBe(true);
    }
  });

  it("never claims rootless egress on non-linux hosts", () => {
    __resetCapabilitiesCacheForTest();
    const caps = detectSandboxCapabilities();
    if (caps.platform !== "linux") {
      expect(caps.netEgressRootless).toBe(false);
    }
  });

  it("only claims egress plumbing on a root nsjail host with a usable iface", () => {
    __resetCapabilitiesCacheForTest();
    const caps = detectSandboxCapabilities();
    // netEgressIface gates the functional (non-blackhole) allowlist / metadata
    // block. It is delivered via nsjail macvlan and needs CAP_NET_ADMIN (euid
    // root). Never claim it without nsjail + root + a netns.
    if (caps.netEgressIface !== null) {
      expect(caps.wrapper).toBe("nsjail");
      expect(caps.euidIsRoot).toBe(true);
      expect(caps.netNamespaces).toBe(true);
    }
  });

  it("userNamespaces is the LIVE clone verdict, equal to userNsCreatable", () => {
    __resetCapabilitiesCacheForTest();
    const caps = detectSandboxCapabilities();
    // Item 3: userNamespaces is now driven by the live clone probe, NOT the
    // static sysctl toggle, so the two fields must agree. This is what closes
    // the truthfulness gap (default Docker seccomp: toggle "available" but live
    // clone blocked) — both report the real verdict.
    expect(caps.userNamespaces).toBe(caps.userNsCreatable);
  });

  it("never claims a net namespace when the live userns clone fails", () => {
    __resetCapabilitiesCacheForTest();
    const caps = detectSandboxCapabilities();
    // netNamespaces is gated on the live probe: on a host where the namespace
    // cannot actually be created, we must NOT claim netNamespaces (bwrap would
    // fail at spawn) — the silent gap Item 3 fixes.
    if (!caps.userNsCreatable) {
      expect(caps.netNamespaces).toBe(false);
      expect(caps.netEgressRootless).toBe(false);
    }
  });

  it("euidIsRoot reflects process.getuid", () => {
    __resetCapabilitiesCacheForTest();
    const caps = detectSandboxCapabilities();
    const getuid = process.getuid?.bind(process);
    const expected = getuid !== undefined && getuid() === 0;
    expect(caps.euidIsRoot).toBe(expected);
  });

  it("caches the result across calls", () => {
    __resetCapabilitiesCacheForTest();
    const first = detectSandboxCapabilities();
    const second = detectSandboxCapabilities();
    expect(second).toBe(first); // same object reference => cached
  });

  it("never claims netNamespaces it cannot deliver via the chosen wrapper", () => {
    __resetCapabilitiesCacheForTest();
    const caps = detectSandboxCapabilities();
    // netNamespaces is delivered ONLY via bwrap/nsjail here; a firejail-only or
    // wrapper-less host must report false even if the kernel supports netns.
    if (caps.wrapper === "firejail" || caps.wrapper === null) {
      expect(caps.netNamespaces).toBe(false);
    }
    // And it can only be true when a delivering wrapper + userns are present.
    if (caps.netNamespaces) {
      expect(caps.wrapper === "bwrap" || caps.wrapper === "nsjail").toBe(true);
      expect(caps.userNamespaces).toBe(true);
    }
  });

  it("non-linux hosts report no prlimit / wrapper / namespaces", () => {
    __resetCapabilitiesCacheForTest();
    const caps = detectSandboxCapabilities();
    if (caps.platform !== "linux") {
      expect(caps.hasPrlimit).toBe(false);
      expect(caps.rlimitNative).toBe(false);
      expect(caps.wrapper).toBeNull();
      expect(caps.userNamespaces).toBe(false);
      expect(caps.netNamespaces).toBe(false);
    }
  });
});
