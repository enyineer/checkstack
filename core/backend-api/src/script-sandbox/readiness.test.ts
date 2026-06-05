import { describe, expect, it } from "bun:test";
import {
  assessSandboxHostReadiness,
  formatSandboxReadinessBanner,
} from "./readiness";
import type { SandboxCapabilities } from "./capabilities";

/** A fully-capable Linux host (every OS layer enforceable). */
const LINUX_READY: SandboxCapabilities = {
  platform: "linux",
  euidIsRoot: false,
  hasPrlimit: true,
  rlimitNative: true,
  wrapper: "bwrap",
  userNamespaces: true,
  netNamespaces: true,
  userNsCreatable: true,
  netEgressIface: null,
  netEgressAddressing: null,
  netEgressRootless: true,
};

describe("assessSandboxHostReadiness", () => {
  it("reports enforceable with no guidance on a fully-capable Linux host", () => {
    const r = assessSandboxHostReadiness({ caps: LINUX_READY });
    expect(r.enforceable).toBe(true);
    expect(r.reasons).toEqual([]);
    expect(r.guidance).toBe("");
  });

  it("is NOT enforceable on darwin and guides to Docker + degrade", () => {
    const r = assessSandboxHostReadiness({
      caps: { ...LINUX_READY, platform: "darwin" },
    });
    expect(r.enforceable).toBe(false);
    expect(r.platform).toBe("darwin");
    expect(r.reasons.join(" ")).toContain("requires Linux");
    // Both supported dev paths must be surfaced.
    expect(r.guidance).toContain("Docker");
    expect(r.guidance).toContain('"degrade"');
    // It must NOT claim to relax enforcement on its own.
    expect(r.guidance).toContain("REFUSED");
  });

  it("is NOT enforceable on a Linux host where the live userns probe fails", () => {
    const r = assessSandboxHostReadiness({
      caps: { ...LINUX_READY, userNsCreatable: false, netNamespaces: false },
    });
    expect(r.enforceable).toBe(false);
    expect(r.reasons.join(" ")).toContain("user + net namespaces");
    expect(r.guidance).toContain("degrade");
  });

  it("flags a missing wrapper and missing prlimit on Linux", () => {
    const r = assessSandboxHostReadiness({
      caps: { ...LINUX_READY, wrapper: null, rlimitNative: false },
    });
    expect(r.enforceable).toBe(false);
    expect(r.reasons.join(" ")).toContain("namespace-capable wrapper");
    expect(r.reasons.join(" ")).toContain("prlimit");
  });
});

describe("formatSandboxReadinessBanner", () => {
  it("returns an empty string when the host is enforceable", () => {
    const readiness = assessSandboxHostReadiness({ caps: LINUX_READY });
    expect(formatSandboxReadinessBanner({ readiness })).toBe("");
  });

  it("frames the guidance with rules + a header when not enforceable", () => {
    const readiness = assessSandboxHostReadiness({
      caps: { ...LINUX_READY, platform: "darwin" },
    });
    const banner = formatSandboxReadinessBanner({ readiness });
    expect(banner).toContain("SCRIPT SANDBOX: OS-LEVEL ISOLATION UNAVAILABLE");
    expect(banner).toContain("=".repeat(78));
    // The full guidance is still embedded in the banner.
    expect(banner).toContain(readiness.guidance);
  });
});
