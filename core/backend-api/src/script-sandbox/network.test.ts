import { describe, expect, it } from "bun:test";
import type { SandboxCapabilities } from "./capabilities";
import {
  ALWAYS_BLOCKED_CIDRS,
  buildEgressNftRules,
  buildNetworkLayer,
} from "./network";
import { networkPolicySchema } from "./policy";

// nsjail host that CAN plumb real egress (root + a usable uplink iface): the
// ONLY configuration where allowlist / the metadata block are deliverable.
const LINUX_NSJAIL_PLUMBED: SandboxCapabilities = {
  platform: "linux",
  euidIsRoot: true,
  hasPrlimit: true,
  rlimitNative: true,
  wrapper: "nsjail",
  userNamespaces: true,
  userNsCreatable: true,
  netNamespaces: true,
  netEgressIface: "eth0",
  netEgressAddressing: {
    ip: "10.0.0.2",
    netmask: "255.255.255.0",
    gateway: "10.0.0.1",
  },
  netEgressRootless: false,
};

// nsjail present, namespace creatable, but egress CANNOT be plumbed (non-root /
// no uplink): deny still works (routeless), allowlist + metadata block degrade.
const LINUX_NSJAIL_NO_PLUMB: SandboxCapabilities = {
  ...LINUX_NSJAIL_PLUMBED,
  euidIsRoot: false,
  netEgressIface: null,
  netEgressAddressing: null,
};

// nsjail + root + uplink, but NO static macvlan addressing configured: the
// macvlan would be routeless, so allowlist / metadata block degrade-and-surface.
const LINUX_NSJAIL_NO_ADDRESSING: SandboxCapabilities = {
  ...LINUX_NSJAIL_PLUMBED,
  netEgressAddressing: null,
};

const LINUX_BWRAP: SandboxCapabilities = {
  ...LINUX_NSJAIL_PLUMBED,
  wrapper: "bwrap",
  netEgressIface: null, // macvlan egress plumbing is nsjail-only
  netEgressAddressing: null,
};

// bwrap host with the ROOTLESS slirp4netns path available (no privileged
// macvlan): the common rootless-container case. allowlist + metadata block are
// deliverable here without root / an uplink / operator addressing.
const LINUX_BWRAP_ROOTLESS: SandboxCapabilities = {
  ...LINUX_BWRAP,
  netEgressRootless: true,
};

// A host where BOTH paths are present: macvlan (nsjail+root+uplink+addressing)
// AND rootless. Used to assert the macvlan path is PREFERRED.
const LINUX_BOTH_PATHS: SandboxCapabilities = {
  ...LINUX_NSJAIL_PLUMBED,
  netEgressRootless: true,
};

const LINUX_NO_NETNS: SandboxCapabilities = {
  ...LINUX_NSJAIL_PLUMBED,
  wrapper: null,
  netNamespaces: false,
  netEgressIface: null,
  netEgressAddressing: null,
};

const MACOS: SandboxCapabilities = {
  platform: "darwin",
  euidIsRoot: false,
  hasPrlimit: false,
  rlimitNative: false,
  wrapper: null,
  userNamespaces: false,
  userNsCreatable: false,
  netNamespaces: false,
  netEgressIface: null,
  netEgressAddressing: null,
  netEgressRootless: false,
};

function net(input: unknown) {
  return networkPolicySchema.parse(input);
}

describe("buildEgressNftRules — always-on metadata/link-local block", () => {
  it("drops the metadata/link-local ranges in allowlist mode", () => {
    const rules = buildEgressNftRules({
      mode: "allowlist",
      allow: ["10.0.0.0/8"],
      denyMetadata: true,
    });
    // The block is emitted BEFORE any accept so it cannot be re-opened.
    expect(rules).toContain("169.254.0.0/16");
    expect(rules).toContain("fe80::/10");
    expect(rules).toContain("fc00::/7");
    const dropIdx = rules.indexOf("169.254.0.0/16");
    const allowIdx = rules.indexOf("10.0.0.0/8");
    expect(dropIdx).toBeLessThan(allowIdx);
    // Allowed CIDR + a final default drop.
    expect(rules).toContain("ip daddr { 10.0.0.0/8 } accept");
    expect(rules.trimEnd().split("\n").some((l) => l.trim() === "drop")).toBe(
      true,
    );
  });

  it("separates IPv4 and IPv6 allow entries onto ip / ip6 rules", () => {
    const rules = buildEgressNftRules({
      mode: "allowlist",
      allow: ["10.0.0.0/8", "2001:db8::/32"],
      denyMetadata: true,
    });
    expect(rules).toContain("ip daddr { 10.0.0.0/8 } accept");
    expect(rules).toContain("ip6 daddr { 2001:db8::/32 } accept");
  });

  it("metadata-only mode default-accepts but still drops the blocked ranges", () => {
    const rules = buildEgressNftRules({
      mode: "metadata-only",
      allow: [],
      denyMetadata: true,
    });
    expect(rules).toContain("policy accept");
    expect(rules).toContain("169.254.0.0/16");
    // No final default drop — everything except the blocked ranges is allowed.
    expect(rules.trimEnd().split("\n").some((l) => l.trim() === "drop")).toBe(
      false,
    );
  });

  it("the always-blocked set covers IPv4 link-local + IPv6 link/unique-local", () => {
    expect(ALWAYS_BLOCKED_CIDRS).toContain("169.254.0.0/16");
    expect(ALWAYS_BLOCKED_CIDRS).toContain("fe80::/10");
    expect(ALWAYS_BLOCKED_CIDRS).toContain("fc00::/7");
  });
});

describe("buildNetworkLayer — deny (routeless netns is the goal)", () => {
  it("takes a fresh routeless namespace, no ruleset, no iface (bwrap)", () => {
    const d = buildNetworkLayer({ policy: net({ mode: "deny" }), caps: LINUX_BWRAP });
    expect(d.kind).toBe("namespaced");
    if (d.kind !== "namespaced") throw new Error("expected namespaced");
    expect(d.mode).toBe("deny");
    expect(d.nftRuleset).toBeUndefined();
    expect(d.egressIface).toBeUndefined(); // routeless: no uplink
  });

  it("deny works on an nsjail host that cannot plumb egress (still routeless)", () => {
    const d = buildNetworkLayer({
      policy: net({ mode: "deny" }),
      caps: LINUX_NSJAIL_NO_PLUMB,
    });
    expect(d.kind).toBe("namespaced");
    if (d.kind !== "namespaced") throw new Error("expected namespaced");
    expect(d.mode).toBe("deny");
    expect(d.egressIface).toBeUndefined();
  });

  it("degrades deny on a host without net namespaces", () => {
    const d = buildNetworkLayer({
      policy: net({ mode: "deny" }),
      caps: LINUX_NO_NETNS,
    });
    expect(d.kind).toBe("degrade");
  });

  it("degrades deny on macOS", () => {
    const d = buildNetworkLayer({ policy: net({ mode: "deny" }), caps: MACOS });
    expect(d.kind).toBe("degrade");
    if (d.kind !== "degrade") throw new Error("expected degrade");
    expect(d.reason).toContain("platform=darwin");
  });
});

describe("buildNetworkLayer — EMPTY allowlist == deny (routeless, no plumbing)", () => {
  it("resolves the secure-default empty allowlist to a routeless deny netns", () => {
    // The shipped secure default: `allowlist` with an EMPTY allow list = no
    // egress at all. It must take the routeless deny path (loopback only), which
    // needs NO macvlan/slirp4netns plumbing and NO nftables ruleset, so it
    // enforces on any netns-capable host - even where in-namespace nft is denied.
    for (const caps of [LINUX_BWRAP, LINUX_BWRAP_ROOTLESS, LINUX_NSJAIL_PLUMBED]) {
      const d = buildNetworkLayer({
        policy: net({ mode: "allowlist", allow: [] }),
        caps,
      });
      expect(d.kind).toBe("namespaced");
      if (d.kind !== "namespaced") throw new Error("expected namespaced");
      expect(d.mode).toBe("deny");
      expect(d.nftRuleset).toBeUndefined();
      expect(d.egressIface).toBeUndefined();
      expect(d.egressPath).toBeUndefined();
    }
  });

  it("still degrades an empty allowlist where no netns wrapper exists", () => {
    const d = buildNetworkLayer({
      policy: net({ mode: "allowlist", allow: [] }),
      caps: MACOS,
    });
    expect(d.kind).toBe("degrade");
  });
});

describe("buildNetworkLayer — allowlist (needs plumbed egress, never blackhole)", () => {
  it("plumbs a macvlan uplink + nftables ruleset when egress is plumbable", () => {
    const d = buildNetworkLayer({
      policy: net({ mode: "allowlist", allow: ["10.0.0.0/8"] }),
      caps: LINUX_NSJAIL_PLUMBED,
    });
    expect(d.kind).toBe("namespaced");
    if (d.kind !== "namespaced") throw new Error("expected namespaced");
    expect(d.mode).toBe("allowlist");
    expect(d.egressIface).toBe("eth0"); // real uplink → allowed CIDR reachable
    expect(d.egressAddressing).toEqual({
      ip: "10.0.0.2",
      netmask: "255.255.255.0",
      gateway: "10.0.0.1",
    });
    expect(d.nftRuleset).toContain("10.0.0.0/8");
    expect(d.nftRuleset).toContain("169.254.0.0/16"); // metadata still blocked
  });

  it("degrades (surfaced) when the macvlan endpoint has no static addressing", () => {
    // The iface is plumbable but no CHECKSTACK_SANDBOX_MACVLAN_* addressing is
    // configured → an unaddressed macvlan has no route, so the allowlist would
    // blackhole. Must degrade-and-surface, never blackhole.
    const d = buildNetworkLayer({
      policy: net({ mode: "allowlist", allow: ["10.0.0.0/8"] }),
      caps: LINUX_NSJAIL_NO_ADDRESSING,
    });
    expect(d.kind).toBe("degrade");
    if (d.kind !== "degrade") throw new Error("expected degrade");
    // Neither path is deliverable (macvlan lacks addressing; not rootless) →
    // the unified degrade reason names the addressing requirement + blackhole.
    expect(d.reason).toContain("macvlan");
    expect(d.reason).toContain("addressing");
    expect(d.reason).toContain("blackhole");
  });

  it("degrades (surfaced) when egress cannot be plumbed — NOT a blackhole", () => {
    const d = buildNetworkLayer({
      policy: net({ mode: "allowlist", allow: ["10.0.0.0/8"] }),
      caps: LINUX_NSJAIL_NO_PLUMB,
    });
    expect(d.kind).toBe("degrade");
    if (d.kind !== "degrade") throw new Error("expected degrade");
    expect(d.reason).toContain("blackhole");
    expect(d.reason).toContain("unrestricted");
  });

  it("degrades on bwrap with NEITHER macvlan NOR rootless egress available", () => {
    const d = buildNetworkLayer({
      policy: net({ mode: "allowlist", allow: ["10.0.0.0/8"] }),
      caps: LINUX_BWRAP,
    });
    expect(d.kind).toBe("degrade");
    if (d.kind !== "degrade") throw new Error("expected degrade");
    expect(d.reason).toContain("rootless");
    expect(d.reason).toContain("slirp4netns");
  });

  it("plumbs the ROOTLESS slirp4netns path on a rootless bwrap host", () => {
    const d = buildNetworkLayer({
      policy: net({ mode: "allowlist", allow: ["10.0.0.0/8"] }),
      caps: LINUX_BWRAP_ROOTLESS,
    });
    expect(d.kind).toBe("namespaced");
    if (d.kind !== "namespaced") throw new Error("expected namespaced");
    expect(d.mode).toBe("allowlist");
    expect(d.egressPath).toBe("rootless");
    // No macvlan iface / addressing on the rootless path (slirp4netns supplies
    // a deterministic userspace stack).
    expect(d.egressIface).toBeUndefined();
    expect(d.egressAddressing).toBeUndefined();
    // The SAME nftables filter applies (allowed CIDR + metadata block).
    expect(d.nftRuleset).toContain("10.0.0.0/8");
    expect(d.nftRuleset).toContain("169.254.0.0/16");
  });

  it("PREFERS the privileged macvlan path when BOTH are available", () => {
    const d = buildNetworkLayer({
      policy: net({ mode: "allowlist", allow: ["10.0.0.0/8"] }),
      caps: LINUX_BOTH_PATHS,
    });
    expect(d.kind).toBe("namespaced");
    if (d.kind !== "namespaced") throw new Error("expected namespaced");
    expect(d.egressPath).toBe("macvlan");
    expect(d.egressIface).toBe("eth0");
    expect(d.egressAddressing).not.toBeUndefined();
  });
});

describe("buildNetworkLayer — unrestricted + metadata block (never sever egress)", () => {
  it("enforces the block in a PLUMBED namespace when egress is available", () => {
    const d = buildNetworkLayer({
      policy: net({ mode: "unrestricted", denyLinkLocalAndMetadata: true }),
      caps: LINUX_NSJAIL_PLUMBED,
    });
    expect(d.kind).toBe("namespaced");
    if (d.kind !== "namespaced") throw new Error("expected namespaced");
    expect(d.egressIface).toBe("eth0"); // ordinary traffic still flows
    expect(d.nftRuleset).toContain("169.254.0.0/16");
  });

  it("does NOT engage a routeless netns when egress is unplumbable (nsjail no-plumb)", () => {
    // BLOCKER guard: a routeless netns here would sever ALL egress. Must keep
    // host net and surface the block as unenforceable, never blackhole.
    const d = buildNetworkLayer({
      policy: net({ mode: "unrestricted", denyLinkLocalAndMetadata: true }),
      caps: LINUX_NSJAIL_NO_PLUMB,
    });
    expect(d.kind).toBe("host");
    if (d.kind !== "host") throw new Error("expected host");
    expect(d.metadataBlockUnenforceable).toBe(true);
  });

  it("reports the metadata block unenforceable on bwrap with no egress path", () => {
    const d = buildNetworkLayer({
      policy: net({ mode: "unrestricted", denyLinkLocalAndMetadata: true }),
      caps: LINUX_BWRAP,
    });
    expect(d.kind).toBe("host");
    if (d.kind !== "host") throw new Error("expected host");
    expect(d.metadataBlockUnenforceable).toBe(true);
  });

  it("enforces the metadata block via the ROOTLESS path when available", () => {
    const d = buildNetworkLayer({
      policy: net({ mode: "unrestricted", denyLinkLocalAndMetadata: true }),
      caps: LINUX_BWRAP_ROOTLESS,
    });
    expect(d.kind).toBe("namespaced");
    if (d.kind !== "namespaced") throw new Error("expected namespaced");
    expect(d.egressPath).toBe("rootless");
    expect(d.egressIface).toBeUndefined(); // ordinary egress still flows via slirp4netns
    expect(d.nftRuleset).toContain("169.254.0.0/16");
  });

  it("stays on the host net with nothing to do when the block is disabled", () => {
    const d = buildNetworkLayer({
      policy: net({ mode: "unrestricted", denyLinkLocalAndMetadata: false }),
      caps: LINUX_NSJAIL_PLUMBED,
    });
    expect(d.kind).toBe("host");
    if (d.kind !== "host") throw new Error("expected host");
    expect(d.metadataBlockUnenforceable).toBe(false);
  });
});
