import { describe, expect, it } from "bun:test";
import type { SandboxCapabilities } from "./capabilities";
import { DEFAULT_SANDBOX_PROFILE, sandboxPolicySchema } from "./policy";
import { SandboxUnavailableError } from "./report";
import { buildSpawnHardening } from "./wrapper";

const baseEnv = { PATH: "/usr/bin", HOME: "/home/u" };

const LINUX_ROOT: SandboxCapabilities = {
  platform: "linux",
  euidIsRoot: true,
  hasPrlimit: true,
  rlimitNative: true,
  wrapper: null,
  userNamespaces: true,
  userNsCreatable: true,
  netNamespaces: false,
  netEgressIface: null,
  netEgressAddressing: null,
  netEgressRootless: false,
};

const LINUX_NONROOT_BWRAP: SandboxCapabilities = {
  platform: "linux",
  euidIsRoot: false,
  hasPrlimit: true,
  rlimitNative: true,
  wrapper: "bwrap",
  userNamespaces: true,
  userNsCreatable: true,
  netNamespaces: true,
  netEgressIface: null, // bwrap cannot plumb egress (macvlan); rootless tested separately
  netEgressAddressing: null,
  netEgressRootless: false,
};

const LINUX_NONROOT_NSJAIL: SandboxCapabilities = {
  ...LINUX_NONROOT_BWRAP,
  wrapper: "nsjail",
};

// Root host WITH a bwrap wrapper + user namespaces: the wrapper can carry the
// `--uid` privilege drop (the only path that actually drops, since Bun.spawn
// ignores uid/gid). This is the container model the shipped images target.
const LINUX_NONROOT_BWRAP_ROOT: SandboxCapabilities = {
  ...LINUX_NONROOT_BWRAP,
  euidIsRoot: true,
};

// nsjail host that CAN plumb real egress (root + uplink + static addressing) —
// required for a functional allowlist / metadata block.
const LINUX_ROOT_NSJAIL_PLUMBED: SandboxCapabilities = {
  ...LINUX_NONROOT_NSJAIL,
  euidIsRoot: true,
  netEgressIface: "eth0",
  netEgressAddressing: {
    ip: "10.0.0.2",
    netmask: "255.255.255.0",
    gateway: "10.0.0.1",
  },
};

// bwrap host with the ROOTLESS slirp4netns egress path (no privileged macvlan):
// the common rootless-container case. allowlist + metadata block are deliverable
// here via the launcher, without root / uplink / operator addressing.
const LINUX_BWRAP_ROOTLESS: SandboxCapabilities = {
  ...LINUX_NONROOT_BWRAP,
  netEgressRootless: true,
};

const MACOS_NONE: SandboxCapabilities = {
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

describe("buildSpawnHardening — disabled sandbox", () => {
  it("behaves like the prior merge with no denylist / caps / uid", () => {
    const policy = sandboxPolicySchema.parse({ enabled: false });
    const h = buildSpawnHardening({
      policy,
      caps: LINUX_ROOT,
      baseEnv,
      envOverrides: { LD_PRELOAD: "/x.so", FOO: "bar" },
    });
    expect(h.wrapCmd(["sh", "-c", "x"])).toEqual(["sh", "-c", "x"]);
    expect(h.env.LD_PRELOAD).toBe("/x.so"); // NOT dropped when disabled
    expect(h.env.FOO).toBe("bar");
    expect(h.uid).toBeUndefined();
    expect(h.maxOutputBytes).toBeUndefined();
    expect(h.droppedEnvKeys).toEqual([]);
  });
});

describe("buildSpawnHardening — resources on a capable Linux root host", () => {
  // A genuinely capable scenario for the RESOURCE + PRIVILEGE layers. The
  // privilege drop is performed by the WRAPPER (bwrap `--uid`), not by
  // Bun.spawn (which ignores uid/gid), so RLIMIT_NPROC — which is per-UID and
  // only safe once the drop is in effect — requires a wrapper-capable host AND
  // FS confinement so the wrapper is engaged. A scratch dir is supplied so the
  // bwrap prelude is built.
  const h = buildSpawnHardening({
    policy: sandboxPolicySchema.parse({
      ...DEFAULT_SANDBOX_PROFILE,
      // Keep the network on the host so this stays a focused resource/privilege
      // test (no egress-plumbing dependency).
      network: { mode: "unrestricted", denyLinkLocalAndMetadata: false },
      privilege: { mode: "drop-to-uid", uid: 1001, gid: 1001 },
    }),
    caps: LINUX_NONROOT_BWRAP_ROOT,
    baseEnv,
    envOverrides: {},
    filesystem: { scratchDir: "/tmp/run-res" },
  });

  it("prepends an FS wrapper + prlimit prelude carrying the uid drop", () => {
    const wrapped = h.wrapCmd(["sh", "-c", "echo hi"]);
    expect(wrapped[0]).toBe("bwrap");
    // The wrapper carries the privilege drop (the path that actually drops).
    expect(wrapped).toContain("--uid");
    expect(wrapped).toContain("1001");
    expect(wrapped).toContain("--gid");
    // prlimit applies INSIDE the wrapper, with all caps including nproc (safe
    // now that the drop is genuinely in effect).
    expect(wrapped).toContain("prlimit");
    expect(wrapped).toContain("--cpu=60");
    expect(wrapped).toContain("--nofile=1024");
    expect(wrapped).toContain("--nproc=256");
    expect(wrapped).toContain("--fsize=268435456");
    // Memory is NOT capped via `--as` (RLIMIT_AS breaks the interpreter); it is
    // the JS heap cap + the cgroup limit instead.
    expect(wrapped.some((a) => a.startsWith("--as="))).toBe(false);
    expect(wrapped.slice(-3)).toEqual(["sh", "-c", "echo hi"]);
  });

  it("marks resources + privilege enforced and surfaces maxOutputBytes + heap cap", () => {
    expect(h.effective.enforced.resources).toBe(true);
    expect(h.effective.enforced.privilege).toBe(true);
    expect(h.maxOutputBytes).toBe(5 * 1024 * 1024);
    // Memory enforced via the JS heap cap, not RLIMIT_AS.
    expect(h.nodeMemoryFlagEnv?.NODE_OPTIONS).toContain("--max-old-space-size=512");
  });

  it("drops privilege to the configured uid via the wrapper when euid is root + uid set", () => {
    const withUid = buildSpawnHardening({
      policy: sandboxPolicySchema.parse({
        filesystem: { mode: "scratch-only" },
        privilege: { mode: "drop-to-uid", uid: 1001, gid: 1001 },
      }),
      caps: LINUX_NONROOT_BWRAP_ROOT,
      baseEnv,
      filesystem: { scratchDir: "/tmp/run-res2" },
    });
    // `h.uid`/`gid` are set for OBSERVABILITY (the wrapper carries the real
    // `--uid` drop); the runner never passes them to Bun.spawn.
    expect(withUid.uid).toBe(1001);
    expect(withUid.gid).toBe(1001);
    expect(withUid.effective.enforced.privilege).toBe(true);
    expect(withUid.wrapCmd(["sh", "-c", "x"])).toContain("--uid");
  });

  it("does NOT enforce privilege (and surfaces it) when no wrapper engages", () => {
    // FS off + host net = no wrapper. Bun.spawn's uid is a silent no-op, so the
    // drop cannot happen; the layer must report not-enforced + a downgrade
    // rather than a false positive.
    const noWrap = buildSpawnHardening({
      policy: sandboxPolicySchema.parse({
        onUnavailable: "degrade",
        filesystem: { mode: "off" },
        network: { mode: "unrestricted", denyLinkLocalAndMetadata: false },
        privilege: { mode: "drop-to-uid", uid: 1001, gid: 1001 },
      }),
      caps: LINUX_NONROOT_BWRAP_ROOT,
      baseEnv,
    });
    expect(noWrap.effective.enforced.privilege).toBe(false);
    const reasons = noWrap.effective.downgrades
      .filter((d) => d.layer === "privilege")
      .map((d) => d.reason);
    expect(reasons.some((r) => r.includes("namespace wrapper"))).toBe(true);
  });
});

describe("buildSpawnHardening — degraded macOS host (onUnavailable: degrade)", () => {
  // The shipped DEFAULT_SANDBOX_PROFILE is now fail-closed, so to exercise the
  // degrade path on a capability-less host we explicitly use the opt-in
  // `degrade` variant (the operator's documented escape hatch for weak hosts).
  const DEGRADE_DEFAULT = sandboxPolicySchema.parse({
    ...DEFAULT_SANDBOX_PROFILE,
    onUnavailable: "degrade",
  });
  const h = buildSpawnHardening({
    policy: DEGRADE_DEFAULT,
    caps: MACOS_NONE,
    baseEnv,
    envOverrides: {},
  });

  it("does NOT hard-break: still returns a hardening result", () => {
    expect(h).toBeDefined();
  });

  it("does not add a prlimit prelude (no rlimit capability)", () => {
    expect(h.wrapCmd(["sh", "-c", "x"])).toEqual(["sh", "-c", "x"]);
  });

  it("surfaces the resource downgrade; privilege is enforced by non-root inheritance", () => {
    const layers = h.effective.downgrades.map((d) => d.layer);
    expect(layers).toContain("resources");
    // Privilege is NOT a downgrade here: MACOS_NONE has a NON-root supervisor
    // (euidIsRoot:false), so the child inherits non-root and cannot be
    // host-root - enforced by construction even with no wrapper.
    expect(layers).not.toContain("privilege");
    expect(h.effective.enforced.resources).toBe(false);
    expect(h.effective.enforced.privilege).toBe(true);
  });

  it("still enforces the portable subset: output cap + ESM memory fallback", () => {
    expect(h.maxOutputBytes).toBe(5 * 1024 * 1024);
    expect(h.nodeMemoryFlagEnv?.NODE_OPTIONS).toContain("--max-old-space-size=");
  });

  it("still applies the env denylist (portable, every platform)", () => {
    const denied = buildSpawnHardening({
      policy: DEGRADE_DEFAULT,
      caps: MACOS_NONE,
      baseEnv,
      envOverrides: { LD_PRELOAD: "/x.so" },
    });
    expect(denied.env.LD_PRELOAD).toBeUndefined();
    expect(denied.droppedEnvKeys).toContain("LD_PRELOAD");
  });
});

describe("buildSpawnHardening — RLIMIT_NPROC fork-bomb cap (Item 1: per-run containment)", () => {
  it("omits --nproc and surfaces a downgrade when no wrapper namespace engages (root, inherit)", () => {
    // Root supervisor, no wrapper-capable host (wrapper:null) => no user
    // namespace to isolate the count, and the child stays host-root: the cap
    // would throttle the host uid, so it is omitted and surfaced.
    const policy = sandboxPolicySchema.parse({
      resources: { maxProcesses: 256, cpuSeconds: 10 },
      privilege: { mode: "inherit" },
    });
    const h = buildSpawnHardening({ policy, caps: LINUX_ROOT, baseEnv });
    const wrapped = h.wrapCmd(["sh", "-c", "x"]);
    expect(wrapped).toContain("--cpu=10");
    expect(wrapped.some((a) => a.startsWith("--nproc="))).toBe(false);
    const resourceDowngrade = h.effective.downgrades.find(
      (d) => d.layer === "resources",
    );
    expect(resourceDowngrade?.reason).toContain("RLIMIT_NPROC");
  });

  it("APPLIES --nproc under a NON-ROOT supervisor when the bwrap wrapper engages (the shipped model)", () => {
    // The core fix: rootless `bwrap --unshare-all` creates a fresh USER
    // namespace, so the per-(uid, userns) RLIMIT_NPROC isolates THIS run's
    // process count even though the child shares the supervisor's uid 65532.
    // No privilege drop, no root: the fork-bomb cap is genuinely per-run here.
    const policy = sandboxPolicySchema.parse({
      resources: { maxProcesses: 128 },
      filesystem: { mode: "scratch-plus-ro" },
      privilege: { mode: "drop-to-uid" }, // satisfied by inheritance (non-root)
      network: { mode: "unrestricted", denyLinkLocalAndMetadata: false },
    });
    const h = buildSpawnHardening({
      policy,
      caps: LINUX_NONROOT_BWRAP,
      baseEnv,
      filesystem: { scratchDir: "/tmp/run-fb" },
    });
    const wrapped = h.wrapCmd(["sh", "-c", "x"]);
    // bwrap wrapper engaged (its own user + PID namespace) -> nproc applied.
    expect(wrapped).toContain("bwrap");
    expect(wrapped).toContain("--unshare-all");
    expect(wrapped).toContain("--nproc=128");
    // No spawn-level uid/gid (inheritance, not a wrapper --uid drop).
    expect(h.uid).toBeUndefined();
    // Privilege enforced by inheritance; resources enforced; NO nproc note.
    expect(h.effective.enforced.privilege).toBe(true);
    expect(h.effective.enforced.resources).toBe(true);
    expect(
      h.effective.notes.some((n) => n.note.includes("RLIMIT_NPROC")),
    ).toBe(false);
  });

  it("omits --nproc + emits a NON-FATAL note when no wrapper engages (non-root, FS off, host net)", () => {
    // The corner case: non-root supervisor but FS off AND host net => no
    // wrapper user namespace, so the child shares the supervisor's uid+userns
    // and a per-uid cap would throttle the supervisor. Omitted, surfaced as a
    // note (never a downgrade, so fail-closed still runs), never applied unsafely.
    const policy = sandboxPolicySchema.parse({
      resources: { maxProcesses: 256, cpuSeconds: 10 },
      filesystem: { mode: "off" },
      network: { mode: "unrestricted", denyLinkLocalAndMetadata: false },
      privilege: { mode: "inherit" },
    });
    const h = buildSpawnHardening({ policy, caps: LINUX_NONROOT_BWRAP, baseEnv });
    expect(
      h.wrapCmd(["sh", "-c", "x"]).some((a) => a.startsWith("--nproc=")),
    ).toBe(false);
    expect(
      h.effective.notes.some((n) => n.note.includes("RLIMIT_NPROC")),
    ).toBe(true);
    // It is a NOTE, not a downgrade (must not trip onUnavailable: fail).
    expect(
      h.effective.downgrades.some((d) => d.layer === "resources"),
    ).toBe(false);
  });

  it("emits --nproc when the privilege drop actually takes effect (wrapper carries --uid)", () => {
    // The drop is performed by the wrapper, so it needs a wrapper-capable root
    // host + FS confinement to engage. Only then is RLIMIT_NPROC safe.
    const policy = sandboxPolicySchema.parse({
      resources: { maxProcesses: 256 },
      filesystem: { mode: "scratch-only" },
      privilege: { mode: "drop-to-uid", uid: 1001, gid: 1001 },
    });
    const h = buildSpawnHardening({
      policy,
      caps: LINUX_NONROOT_BWRAP_ROOT,
      baseEnv,
      filesystem: { scratchDir: "/tmp/run-nproc" },
    });
    const wrapped = h.wrapCmd(["sh", "-c", "x"]);
    expect(wrapped).toContain("--nproc=256");
    expect(wrapped).toContain("--uid");
    // `h.uid` is set for observability; the wrapper carries the real drop.
    expect(h.uid).toBe(1001);
    expect(h.effective.enforced.privilege).toBe(true);
  });

  it("omits --nproc when drop-to-uid was requested but euid is not root", () => {
    const policy = sandboxPolicySchema.parse({
      resources: { maxProcesses: 256, cpuSeconds: 10 },
      privilege: { mode: "drop-to-uid", uid: 1001 },
    });
    const h = buildSpawnHardening({ policy, caps: LINUX_NONROOT_BWRAP, baseEnv });
    expect(h.wrapCmd(["sh", "-c", "x"]).some((a) => a.startsWith("--nproc="))).toBe(
      false,
    );
  });
});

describe("buildSpawnHardening — filesystem layer (Phase 2)", () => {
  it("wraps the command in a bwrap prelude when FS isolation is enforceable", () => {
    const policy = sandboxPolicySchema.parse({
      filesystem: { mode: "scratch-plus-ro" },
      privilege: { mode: "inherit" },
    });
    const h = buildSpawnHardening({
      policy,
      caps: LINUX_NONROOT_BWRAP,
      baseEnv,
      filesystem: {
        scratchDir: "/tmp/run-a",
        nodeModulesDir: "/store/current/node_modules",
      },
    });
    const wrapped = h.wrapCmd([process.execPath, "runner.mjs"]);
    expect(wrapped[0]).toBe("bwrap");
    // The real command is still at the tail.
    expect(wrapped.slice(-2)).toEqual([process.execPath, "runner.mjs"]);
    expect(h.effective.enforced.filesystem).toBe(true);
  });

  it("composes the FS wrapper OUTSIDE the prlimit prelude", () => {
    const policy = sandboxPolicySchema.parse({
      filesystem: { mode: "scratch-only" },
      resources: { cpuSeconds: 30 },
      privilege: { mode: "inherit" },
    });
    const h = buildSpawnHardening({
      policy,
      caps: LINUX_NONROOT_BWRAP,
      baseEnv,
      filesystem: { scratchDir: "/tmp/run-b" },
    });
    const wrapped = h.wrapCmd(["sh", "-c", "x"]);
    const bwrapIdx = wrapped.indexOf("bwrap");
    const prlimitIdx = wrapped.indexOf("prlimit");
    expect(bwrapIdx).toBe(0);
    expect(prlimitIdx).toBeGreaterThan(bwrapIdx);
  });

  it("degrades FS to off + surfaces it on a no-wrapper host", () => {
    const policy = sandboxPolicySchema.parse({
      filesystem: { mode: "scratch-only" },
      privilege: { mode: "inherit" },
    });
    const h = buildSpawnHardening({
      policy,
      caps: LINUX_ROOT, // wrapper: null
      baseEnv,
      filesystem: { scratchDir: "/tmp/run-c" },
    });
    expect(h.effective.enforced.filesystem).toBe(false);
    expect(h.effective.downgrades.map((d) => d.layer)).toContain("filesystem");
    // No bwrap/nsjail in the wrapped argv when degraded.
    expect(h.wrapCmd(["sh", "-c", "x"])).not.toContain("bwrap");
  });

  it("degrades FS when the runner provides no scratch dir (e.g. shell runner)", () => {
    const policy = sandboxPolicySchema.parse({
      filesystem: { mode: "scratch-only" },
      privilege: { mode: "inherit" },
    });
    const h = buildSpawnHardening({
      policy,
      caps: LINUX_NONROOT_BWRAP,
      baseEnv,
      // no filesystem inputs
    });
    expect(h.effective.enforced.filesystem).toBe(false);
    const fsDowngrade = h.effective.downgrades.find(
      (d) => d.layer === "filesystem",
    );
    expect(fsDowngrade?.reason).toContain("scratch dir");
  });

  it("fail-closed: FS unenforceable + onUnavailable:fail throws before spawn", () => {
    const policy = sandboxPolicySchema.parse({
      onUnavailable: "fail",
      filesystem: { mode: "scratch-only" },
      privilege: { mode: "inherit" },
      network: { denyLinkLocalAndMetadata: false },
    });
    expect(() =>
      buildSpawnHardening({
        policy,
        caps: LINUX_ROOT, // no wrapper
        baseEnv,
        filesystem: { scratchDir: "/tmp/run-d" },
      }),
    ).toThrow(SandboxUnavailableError);
  });
});

describe("buildSpawnHardening — filesystem interpreter bind (P2 fix)", () => {
  it("ro-binds the interpreter when it lives outside the base paths", () => {
    const policy = sandboxPolicySchema.parse({
      filesystem: { mode: "scratch-only" },
      privilege: { mode: "inherit" },
      network: { denyLinkLocalAndMetadata: false },
    });
    const h = buildSpawnHardening({
      policy,
      caps: LINUX_NONROOT_BWRAP,
      baseEnv,
      filesystem: {
        scratchDir: "/tmp/run-i",
        interpreterPath: "/home/u/.bun/bin/bun",
      },
      // pathExists/realpath are real here; assert via wrapping the prelude.
    });
    const wrapped = h.wrapCmd(["/home/u/.bun/bin/bun", "runner.mjs"]).join(" ");
    // Bind only emitted when the interpreter exists on disk; this is a unit
    // host where it likely does not, so we assert the COMPOSITION shape instead
    // in the dedicated filesystem.test. Here we at least confirm no crash and a
    // bwrap prelude.
    expect(wrapped.startsWith("bwrap")).toBe(true);
  });
});

describe("buildSpawnHardening — TMPDIR override under FS confinement (P2 fix)", () => {
  it("pins TMPDIR=/tmp when the FS wrapper is enforced", () => {
    const policy = sandboxPolicySchema.parse({
      filesystem: { mode: "scratch-only" },
      privilege: { mode: "inherit" },
      network: { denyLinkLocalAndMetadata: false },
    });
    const h = buildSpawnHardening({
      policy,
      caps: LINUX_NONROOT_BWRAP,
      baseEnv: { ...baseEnv, TMPDIR: "/host/tmp" },
      filesystem: { scratchDir: "/tmp/run-t" },
    });
    expect(h.env.TMPDIR).toBe("/tmp");
  });

  it("does NOT override TMPDIR when FS confinement is off", () => {
    const policy = sandboxPolicySchema.parse({
      filesystem: { mode: "off" },
      privilege: { mode: "inherit" },
      network: { denyLinkLocalAndMetadata: false },
    });
    const h = buildSpawnHardening({
      policy,
      caps: LINUX_NONROOT_BWRAP,
      baseEnv: { ...baseEnv, TMPDIR: "/host/tmp" },
    });
    expect(h.env.TMPDIR).toBe("/host/tmp");
  });
});

describe("buildSpawnHardening — network egress (Phase 3)", () => {
  it("deny: composes a fresh net namespace into the FS wrapper (bwrap)", () => {
    const policy = sandboxPolicySchema.parse({
      filesystem: { mode: "scratch-only" },
      network: { mode: "deny" },
      privilege: { mode: "inherit" },
    });
    const h = buildSpawnHardening({
      policy,
      caps: LINUX_NONROOT_BWRAP,
      baseEnv,
      filesystem: { scratchDir: "/tmp/run-n1" },
    });
    const wrapped = h.wrapCmd(["sh", "-c", "x"]);
    // ONE wrapper invocation, taking a fresh net namespace (no --share-net).
    expect(wrapped[0]).toBe("bwrap");
    expect(wrapped).toContain("--unshare-net");
    expect(wrapped).not.toContain("--share-net");
    expect(h.effective.enforced.network).toBe(true);
    expect(h.effective.enforced.filesystem).toBe(true);
    expect(h.nftRuleset).toBeUndefined(); // deny needs no ruleset
  });

  it("FS stays on host net when network is unrestricted + block disabled", () => {
    const policy = sandboxPolicySchema.parse({
      filesystem: { mode: "scratch-only" },
      network: { mode: "unrestricted", denyLinkLocalAndMetadata: false },
      privilege: { mode: "inherit" },
    });
    const h = buildSpawnHardening({
      policy,
      caps: LINUX_NONROOT_BWRAP,
      baseEnv,
      filesystem: { scratchDir: "/tmp/run-n2" },
    });
    const wrapped = h.wrapCmd(["sh", "-c", "x"]);
    expect(wrapped).toContain("--share-net");
    expect(wrapped).not.toContain("--unshare-net");
    expect(h.effective.enforced.network).toBe(true);
  });

  it("allowlist: plumbs macvlan egress + nft ruleset on a plumbed nsjail host", () => {
    const policy = sandboxPolicySchema.parse({
      filesystem: { mode: "scratch-plus-ro" },
      network: { mode: "allowlist", allow: ["10.0.0.0/8"] },
      privilege: { mode: "inherit" },
    });
    const h = buildSpawnHardening({
      policy,
      caps: LINUX_ROOT_NSJAIL_PLUMBED,
      baseEnv,
      filesystem: { scratchDir: "/tmp/run-n3" },
      nftRulesetPath: "/tmp/run-n3/egress.nft",
    });
    const wrapped = h.wrapCmd([process.execPath, "runner.mjs"]);
    expect(wrapped[0]).toBe("nsjail");
    expect(wrapped).toContain("--clone_newnet");
    // Real uplink plumbed in → allowed CIDR reachable (not a blackhole).
    expect(wrapped).toContain("--macvlan_iface");
    expect(wrapped).toContain("eth0");
    expect(wrapped).toContain("--nftables_file");
    expect(wrapped).toContain("/tmp/run-n3/egress.nft");
    expect(h.nftRuleset).toContain("10.0.0.0/8");
    expect(h.effective.enforced.network).toBe(true);
  });

  it("allowlist degrades (surfaced, NOT blackhole) on an nsjail host without plumbing", () => {
    const policy = sandboxPolicySchema.parse({
      filesystem: { mode: "off" },
      network: { mode: "allowlist", allow: ["10.0.0.0/8"] },
      privilege: { mode: "inherit" },
    });
    const h = buildSpawnHardening({
      policy,
      caps: LINUX_NONROOT_NSJAIL, // nsjail but euid not root / no iface
      baseEnv,
    });
    expect(h.effective.enforced.network).toBe(false);
    expect(h.effective.downgrades.map((d) => d.layer)).toContain("network");
    // Degrade-to-host-net: NO routeless namespace engaged.
    expect(h.wrapCmd(["sh", "-c", "x"])).not.toContain("--clone_newnet");
  });

  it("allowlist degrades on bwrap (no plumbing), surfaced", () => {
    const policy = sandboxPolicySchema.parse({
      filesystem: { mode: "off" },
      network: { mode: "allowlist", allow: ["10.0.0.0/8"] },
      privilege: { mode: "inherit" },
    });
    const h = buildSpawnHardening({
      policy,
      caps: LINUX_NONROOT_BWRAP,
      baseEnv,
    });
    expect(h.effective.enforced.network).toBe(false);
    expect(h.effective.downgrades.map((d) => d.layer)).toContain("network");
    expect(h.wrapCmd(["sh", "-c", "x"])).not.toContain("--unshare-net");
  });

  it("allowlist: ROOTLESS path builds a launcher prelude + nft filter, enforced.network truthful", () => {
    const policy = sandboxPolicySchema.parse({
      filesystem: { mode: "scratch-plus-ro" },
      network: { mode: "allowlist", allow: ["10.0.0.0/8"] },
      privilege: { mode: "inherit" },
    });
    const h = buildSpawnHardening({
      policy,
      caps: LINUX_BWRAP_ROOTLESS,
      baseEnv,
      filesystem: { scratchDir: "/tmp/run-rl1" },
      nftRulesetPath: "/tmp/run-rl1/egress.nft",
      rootlessLauncherPath: "/tmp/run-rl1/rootless-egress.sh",
    });
    // The prelude is the staged launcher script (slirp4netns + fail-closed nft).
    const wrapped = h.wrapCmd([process.execPath, "runner.mjs"]);
    expect(wrapped[0]).toBe("sh");
    expect(wrapped[1]).toBe("/tmp/run-rl1/rootless-egress.sh");
    // The real command is appended as the launcher's positional args.
    expect(wrapped).toContain(process.execPath);
    expect(wrapped).toContain("runner.mjs");
    // The launcher script + nft ruleset are produced for the runner to stage.
    expect(h.rootlessLauncher).toBeDefined();
    expect(h.rootlessLauncher).toContain("slirp4netns --configure");
    expect(h.rootlessLauncher).toContain("--unshare-net"); // bwrap takes a fresh netns
    expect(h.nftRuleset).toContain("10.0.0.0/8");
    expect(h.nftRuleset).toContain("169.254.0.0/16"); // metadata still blocked
    // enforced.network is TRUE only because the filter is loaded fail-closed
    // inside a plumbed (slirp4netns) namespace — real, filtered egress.
    expect(h.effective.enforced.network).toBe(true);
    expect(h.effective.enforced.filesystem).toBe(true);
  });

  it("ROOTLESS path threads the prlimit prelude AFTER the launcher, BEFORE the command", () => {
    // A rootless bwrap host that is ALSO euid-root (so the uid drop takes
    // effect, enabling RLIMIT_NPROC) with full rlimit caps. The launcher path
    // must come first; the prlimit prelude + real command are appended as the
    // launcher's positional args, so prlimit runs INSIDE the namespace (via the
    // inner `exec "$@"`) and caps the real command — not the launcher itself.
    const rootlessRoot: SandboxCapabilities = {
      ...LINUX_BWRAP_ROOTLESS,
      euidIsRoot: true,
    };
    const policy = sandboxPolicySchema.parse({
      ...DEFAULT_SANDBOX_PROFILE,
      filesystem: { mode: "scratch-plus-ro" },
      network: { mode: "allowlist", allow: ["10.0.0.0/8"] },
      privilege: { mode: "drop-to-uid", uid: 1001, gid: 1001 },
    });
    const h = buildSpawnHardening({
      policy,
      caps: rootlessRoot,
      baseEnv,
      filesystem: { scratchDir: "/tmp/run-rl4" },
      nftRulesetPath: "/tmp/run-rl4/egress.nft",
      rootlessLauncherPath: "/tmp/run-rl4/rootless-egress.sh",
    });
    // The uid drop took effect (precondition for --nproc) and resources/network
    // are both enforced. `h.uid` is set for observability (the wrapper carries
    // the real `--uid` drop; the runner never passes it to Bun.spawn).
    expect(h.uid).toBe(1001);
    expect(h.effective.enforced.resources).toBe(true);
    expect(h.effective.enforced.network).toBe(true);

    const wrapped = h.wrapCmd([process.execPath, "runner.mjs"]);
    // Launcher first.
    expect(wrapped[0]).toBe("sh");
    expect(wrapped[1]).toBe("/tmp/run-rl4/rootless-egress.sh");
    // The prlimit prelude is threaded as the launcher's positional args, AFTER
    // the launcher path, terminated by `--`, then the real command.
    const prlimitIdx = wrapped.indexOf("prlimit");
    const sepIdx = wrapped.indexOf("--", prlimitIdx);
    const cmdIdx = wrapped.indexOf(process.execPath);
    expect(prlimitIdx).toBeGreaterThan(1); // after `sh <launcher>`
    expect(wrapped).toContain("--cpu=60");
    expect(wrapped.some((a) => a.startsWith("--as="))).toBe(false); // no RLIMIT_AS
    expect(wrapped).toContain("--nproc=256"); // emitted because the uid dropped
    // Ordering: launcher path < prlimit < `--` < real command.
    expect(prlimitIdx).toBeLessThan(sepIdx);
    expect(sepIdx).toBeLessThan(cmdIdx);
    // The launcher itself is NOT wrapped by prlimit (it precedes the prelude).
    expect(wrapped.indexOf("/tmp/run-rl4/rootless-egress.sh")).toBeLessThan(
      prlimitIdx,
    );
  });

  it("ROOTLESS path degrades (surfaced) when the runner cannot stage a launcher", () => {
    // No rootlessLauncherPath provided → cannot orchestrate slirp4netns → must
    // degrade to host net, NOT take a routeless namespace (blackhole).
    const policy = sandboxPolicySchema.parse({
      filesystem: { mode: "off" },
      network: { mode: "allowlist", allow: ["10.0.0.0/8"] },
      privilege: { mode: "inherit" },
    });
    const h = buildSpawnHardening({
      policy,
      caps: LINUX_BWRAP_ROOTLESS,
      baseEnv,
      nftRulesetPath: "/tmp/run-rl2/egress.nft",
      // rootlessLauncherPath intentionally omitted.
    });
    expect(h.effective.enforced.network).toBe(false);
    expect(h.effective.downgrades.map((d) => d.layer)).toContain("network");
    expect(h.rootlessLauncher).toBeUndefined();
    // Degrade-to-host-net: the cmd runs as-is (no launcher prelude, no netns).
    const wrapped = h.wrapCmd(["sh", "-c", "x"]);
    expect(wrapped).toEqual(["sh", "-c", "x"]);
    expect(wrapped).not.toContain("/tmp/run-rl2/rootless-egress.sh");
    expect(wrapped).not.toContain("--unshare-net");
  });

  it("a NON-EMPTY allowlist enforces egress via the ROOTLESS path", () => {
    // A non-empty allowlist genuinely needs plumbed+filtered egress; on a
    // rootless bwrap host it engages the slirp4netns launcher so the nft filter
    // is installed in a real namespace - enforced.network truthful, never a
    // blackhole. (The EMPTY-allowlist secure default takes the simpler routeless
    // deny path; see the dedicated test below.)
    const h = buildSpawnHardening({
      policy: sandboxPolicySchema.parse({
        ...DEFAULT_SANDBOX_PROFILE,
        onUnavailable: "degrade",
        network: { mode: "allowlist", allow: ["10.0.0.0/8"] },
      }),
      caps: LINUX_BWRAP_ROOTLESS,
      baseEnv,
      filesystem: { scratchDir: "/tmp/run-rl3" },
      nftRulesetPath: "/tmp/run-rl3/egress.nft",
      rootlessLauncherPath: "/tmp/run-rl3/rootless-egress.sh",
    });
    expect(h.rootlessLauncher).toBeDefined();
    expect(h.nftRuleset).toContain("169.254.0.0/16");
    expect(h.effective.enforced.network).toBe(true);
  });

  it("EMPTY-allowlist secure default resolves to the routeless DENY netns (works without plumbing)", () => {
    // The shipped secure default is `allowlist` with an EMPTY allow list =
    // deny ALL egress. That is semantically `deny`, so it takes the routeless
    // namespace path: NO slirp4netns/macvlan plumbing and NO nftables ruleset
    // are needed, so it enforces on ANY netns-capable host (incl. rootless
    // containers where in-namespace nft is not permitted). A routeless netns
    // also inherently blocks metadata (nothing routes).
    const h = buildSpawnHardening({
      policy: sandboxPolicySchema.parse({
        ...DEFAULT_SANDBOX_PROFILE,
        privilege: { mode: "drop-to-uid", uid: 1001, gid: 1001 },
      }),
      caps: LINUX_ROOT_NSJAIL_PLUMBED,
      baseEnv,
      filesystem: { scratchDir: "/tmp/run-id1" },
      nftRulesetPath: "/tmp/run-id1/egress.nft",
    });
    const wrapped = h.wrapCmd([process.execPath, "runner.mjs"]);
    // Routeless deny netns: NO macvlan uplink, NO egress filter file.
    expect(wrapped).toContain("--clone_newnet");
    expect(wrapped).not.toContain("--macvlan_iface");
    expect(wrapped).not.toContain("--nftables_file");
    expect(h.nftRuleset).toBeUndefined();
    expect(h.effective.enforced.network).toBe(true);
    expect(h.effective.downgrades.map((d) => d.layer)).not.toContain("network");
  });

  it("a NON-EMPTY allowlist enforces via the macvlan uplink on a plumbed nsjail host", () => {
    const h = buildSpawnHardening({
      policy: sandboxPolicySchema.parse({
        ...DEFAULT_SANDBOX_PROFILE,
        network: { mode: "allowlist", allow: ["203.0.113.0/24"] },
        privilege: { mode: "drop-to-uid", uid: 1001, gid: 1001 },
      }),
      caps: LINUX_ROOT_NSJAIL_PLUMBED,
      baseEnv,
      filesystem: { scratchDir: "/tmp/run-id1b" },
      nftRulesetPath: "/tmp/run-id1b/egress.nft",
    });
    const wrapped = h.wrapCmd([process.execPath, "runner.mjs"]);
    expect(wrapped).toContain("--macvlan_iface");
    expect(wrapped).toContain("--nftables_file");
    expect(h.nftRuleset).toContain("169.254.0.0/16");
    expect(h.effective.enforced.network).toBe(true);
  });

  it("a NON-EMPTY allowlist does NOT blackhole on an nsjail host without plumbing (host net, surfaced)", () => {
    // BLOCKER guard: a genuine (non-empty) allowlist on a host that cannot plumb
    // egress must keep HOST net (no routeless netns that would blackhole the
    // allowed destinations), surface the gap, and report enforced.network=false.
    const h = buildSpawnHardening({
      policy: sandboxPolicySchema.parse({
        ...DEFAULT_SANDBOX_PROFILE,
        onUnavailable: "degrade",
        network: { mode: "allowlist", allow: ["10.0.0.0/8"] },
      }),
      caps: LINUX_NONROOT_NSJAIL,
      baseEnv,
      filesystem: { scratchDir: "/tmp/run-id2" },
    });
    const wrapped = h.wrapCmd([process.execPath, "runner.mjs"]);
    expect(wrapped).not.toContain("--clone_newnet"); // no severing namespace
    expect(wrapped).not.toContain("--unshare-net");
    expect(h.effective.enforced.network).toBe(false);
    const nd = h.effective.downgrades.find((d) => d.layer === "network");
    // The allowlist could not be plumbed; egress is left on host net rather
    // than blackholed.
    expect(nd?.reason).toContain("blackhole");
    expect(h.nftRuleset).toBeUndefined();
  });

  it("network-only deny (no FS) still builds a wrapper keeping host FS visible", () => {
    const policy = sandboxPolicySchema.parse({
      filesystem: { mode: "off" },
      network: { mode: "deny" },
      privilege: { mode: "inherit" },
    });
    const h = buildSpawnHardening({
      policy,
      caps: LINUX_NONROOT_BWRAP,
      baseEnv,
    });
    const wrapped = h.wrapCmd(["sh", "-c", "x"]);
    expect(wrapped[0]).toBe("bwrap");
    expect(wrapped).toContain("--unshare-net");
    // No FS confinement → host FS bound in so `sh` still resolves.
    expect(wrapped.join(" ")).toContain("--bind / /");
    expect(h.effective.enforced.network).toBe(true);
  });

  it("metadata block requested but unenforceable (bwrap) is surfaced, not pretended", () => {
    const policy = sandboxPolicySchema.parse({
      filesystem: { mode: "off" },
      network: { mode: "unrestricted", denyLinkLocalAndMetadata: true },
      privilege: { mode: "inherit" },
    });
    const h = buildSpawnHardening({
      policy,
      caps: LINUX_NONROOT_BWRAP,
      baseEnv,
    });
    expect(h.effective.enforced.network).toBe(false);
    const nd = h.effective.downgrades.find((d) => d.layer === "network");
    expect(nd?.reason).toContain("metadata");
  });

  it("network deny degrades on macOS and is surfaced", () => {
    const policy = sandboxPolicySchema.parse({
      filesystem: { mode: "off" },
      network: { mode: "deny" },
      privilege: { mode: "inherit" },
    });
    const h = buildSpawnHardening({ policy, caps: MACOS_NONE, baseEnv });
    expect(h.effective.enforced.network).toBe(false);
    expect(h.effective.downgrades.map((d) => d.layer)).toContain("network");
    expect(h.wrapCmd(["sh", "-c", "x"])).toEqual(["sh", "-c", "x"]);
  });

  it("fail-closed: network deny unenforceable + onUnavailable:fail throws", () => {
    const policy = sandboxPolicySchema.parse({
      onUnavailable: "fail",
      filesystem: { mode: "off" },
      network: { mode: "deny" },
      privilege: { mode: "inherit" },
    });
    expect(() =>
      buildSpawnHardening({ policy, caps: MACOS_NONE, baseEnv }),
    ).toThrow(SandboxUnavailableError);
  });
});

describe("buildSpawnHardening — non-root supervisor privilege model", () => {
  // The shipped images run the SUPERVISOR as non-root (uid 65532). The script
  // inherits non-root from the supervisor by construction, so it can NEVER be
  // host-root, regardless of whether a wrapper carries a `--uid` drop. A
  // rootless `--uid` to a DIFFERENT id is impossible (no subuid/newuidmap) and
  // not needed. So `enforced.privilege` must be TRUE on every non-root-euid
  // path, and the wrapper must NOT carry a `--uid` flag.
  const policy = sandboxPolicySchema.parse({
    filesystem: { mode: "scratch-plus-ro" },
    network: { mode: "deny" },
    privilege: { mode: "drop-to-uid", uid: 65532, gid: 65532 },
  });

  it("enforces privilege by inheritance when euid is non-root + wrapper engaged", () => {
    const h = buildSpawnHardening({
      policy,
      caps: LINUX_NONROOT_BWRAP, // euidIsRoot: false
      baseEnv,
      filesystem: { scratchDir: "/tmp/run-nr1" },
    });
    expect(h.effective.enforced.privilege).toBe(true);
    // No wrapper-level uid drop (rootless cannot map to a different id).
    const wrapped = h.wrapCmd(["sh", "-c", "x"]);
    expect(wrapped).not.toContain("--uid");
    expect(wrapped).not.toContain("--gid");
    // Spawn-level uid/gid are NOT carried (no-op + forward-compat hazard).
    expect(h.uid).toBeUndefined();
    expect(h.gid).toBeUndefined();
    // No privilege downgrade surfaced (it IS enforced by inheritance).
    expect(h.effective.downgrades.map((d) => d.layer)).not.toContain("privilege");
  });

  it("enforces privilege by inheritance when euid is non-root + NO wrapper", () => {
    // FS off + host net = no wrapper. With a non-root supervisor the child STILL
    // cannot be host-root (inheritance), so privilege is enforced and there is
    // no spawn uid/gid and no downgrade.
    const h = buildSpawnHardening({
      policy: sandboxPolicySchema.parse({
        onUnavailable: "degrade",
        filesystem: { mode: "off" },
        network: { mode: "unrestricted", denyLinkLocalAndMetadata: false },
        privilege: { mode: "drop-to-uid", uid: 65532, gid: 65532 },
      }),
      caps: LINUX_NONROOT_BWRAP,
      baseEnv,
    });
    expect(h.effective.enforced.privilege).toBe(true);
    expect(h.uid).toBeUndefined();
    expect(h.gid).toBeUndefined();
    expect(h.effective.downgrades.map((d) => d.layer)).not.toContain("privilege");
  });

  it("does NOT report privilege enforced when euid IS root and NO wrapper carries the drop", () => {
    // Legacy root-supervisor path: a drop-to-uid with no wrapper engaged cannot
    // drop (Bun.spawn uid/gid is a silent no-op), so the child WOULD run as
    // host-root. Must NOT claim enforced; must surface a downgrade.
    const h = buildSpawnHardening({
      policy: sandboxPolicySchema.parse({
        onUnavailable: "degrade",
        filesystem: { mode: "off" },
        network: { mode: "unrestricted", denyLinkLocalAndMetadata: false },
        privilege: { mode: "drop-to-uid", uid: 1001, gid: 1001 },
      }),
      caps: LINUX_NONROOT_BWRAP_ROOT, // euidIsRoot: true
      baseEnv,
    });
    expect(h.effective.enforced.privilege).toBe(false);
    expect(h.effective.downgrades.map((d) => d.layer)).toContain("privilege");
    // No spawn uid/gid even on the root path when no wrapper carries the drop:
    // passing them is a no-op today and a forward-compat hazard (a future Bun
    // honoring them would spawn bwrap itself as the dropped id, breaking userns).
    expect(h.uid).toBeUndefined();
    expect(h.gid).toBeUndefined();
  });

  it("root supervisor + wrapper still carries --uid drop and reports enforced", () => {
    const h = buildSpawnHardening({
      policy: sandboxPolicySchema.parse({
        filesystem: { mode: "scratch-only" },
        privilege: { mode: "drop-to-uid", uid: 1001, gid: 1001 },
      }),
      caps: LINUX_NONROOT_BWRAP_ROOT,
      baseEnv,
      filesystem: { scratchDir: "/tmp/run-root-drop" },
    });
    expect(h.effective.enforced.privilege).toBe(true);
    const wrapped = h.wrapCmd(["sh", "-c", "x"]);
    expect(wrapped).toContain("--uid");
    expect(wrapped).toContain("1001");
    // On the genuine root-wrapper drop path `h.uid` IS set, but for
    // OBSERVABILITY only - the runners never pass it to Bun.spawn (verified in
    // the runner tests). The wrapper's `--uid` is what actually drops.
    expect(h.uid).toBe(1001);
    expect(h.gid).toBe(1001);
  });

  it("fail-closed default works on a non-root rootless host (no unexpected downgrades)", () => {
    // The KEY acceptance: under the shipped fail-default on a non-root rootless
    // bwrap host, every applicable layer is enforced and the run is NOT refused.
    const h = buildSpawnHardening({
      policy: sandboxPolicySchema.parse({
        ...DEFAULT_SANDBOX_PROFILE, // onUnavailable: "fail"
        privilege: { mode: "drop-to-uid", uid: 65532, gid: 65532 },
      }),
      caps: { ...LINUX_BWRAP_ROOTLESS, euidIsRoot: false },
      baseEnv,
      filesystem: { scratchDir: "/tmp/run-faildef" },
      nftRulesetPath: "/tmp/run-faildef/egress.nft",
      rootlessLauncherPath: "/tmp/run-faildef/rootless-egress.sh",
    });
    // Empty allowlist => routeless deny netns (no plumbing needed).
    expect(h.effective.enforced.network).toBe(true);
    expect(h.effective.enforced.filesystem).toBe(true);
    expect(h.effective.enforced.resources).toBe(true);
    expect(h.effective.enforced.privilege).toBe(true);
    expect(h.effective.downgrades).toEqual([]);
  });
});

describe("buildSpawnHardening — shell memory honesty (review MAJOR)", () => {
  it("emits a non-fatal memory note (NOT a downgrade) when the node heap cap is not applied", () => {
    // Shell runs do not consume NODE_OPTIONS=--max-old-space-size, so per-run
    // memory is NOT enforced; the ceiling is the cgroup. This must be surfaced
    // as a NOTE, never a downgrade, and must NOT fail-close.
    const policy = sandboxPolicySchema.parse({
      ...DEFAULT_SANDBOX_PROFILE,
      onUnavailable: "fail",
      privilege: { mode: "drop-to-uid", uid: 65532, gid: 65532 },
    });
    const h = buildSpawnHardening({
      policy,
      caps: { ...LINUX_BWRAP_ROOTLESS, euidIsRoot: false },
      baseEnv,
      filesystem: { scratchDir: "/tmp/run-shmem" },
      appliesNodeMemoryCap: false, // shell runner
    });
    const memNote = h.effective.notes.find(
      (n) => n.layer === "resources" && n.note.includes("memoryBytes"),
    );
    expect(memNote).toBeDefined();
    expect(memNote?.note).toContain("cgroup");
    // Memory must NOT appear as a downgrade (would fail-close + break all shell).
    expect(
      h.effective.downgrades.some(
        (d) => d.layer === "resources" && d.reason.includes("memory"),
      ),
    ).toBe(false);
  });

  it("does NOT emit the shell memory note when the node heap cap IS applied (ESM)", () => {
    const policy = sandboxPolicySchema.parse({
      ...DEFAULT_SANDBOX_PROFILE,
      privilege: { mode: "drop-to-uid", uid: 65532, gid: 65532 },
    });
    const h = buildSpawnHardening({
      policy,
      caps: { ...LINUX_BWRAP_ROOTLESS, euidIsRoot: false },
      baseEnv,
      filesystem: { scratchDir: "/tmp/run-esmmem" },
      appliesNodeMemoryCap: true, // ESM runner
    });
    // No MEMORY note for ESM (the heap cap IS applied). An unrelated nproc note
    // may exist under the non-root model; we assert specifically on memory.
    expect(
      h.effective.notes.find(
        (n) => n.layer === "resources" && n.note.includes("memoryBytes"),
      ),
    ).toBeUndefined();
    expect(h.nodeMemoryFlagEnv?.NODE_OPTIONS).toContain("--max-old-space-size=");
  });

  it("REGRESSION GUARD: shell memory is never reported as per-run enforced", () => {
    // This test must FAIL if a future change ever makes the hardening builder
    // imply a per-run memory guarantee for a runner that does not apply the heap
    // cap (i.e. the shell runner, appliesNodeMemoryCap !== true). The honest
    // representation is: a memory note is present whenever memoryBytes is set but
    // the node heap cap is not applied.
    for (const caps of [
      LINUX_NONROOT_BWRAP,
      LINUX_NONROOT_BWRAP_ROOT,
      MACOS_NONE,
    ] as const) {
      const h = buildSpawnHardening({
        policy: sandboxPolicySchema.parse({
          onUnavailable: "degrade",
          resources: { memoryBytes: 512 * 1024 * 1024 },
          filesystem: { mode: "off" },
          network: { mode: "unrestricted", denyLinkLocalAndMetadata: false },
          privilege: { mode: "inherit" },
        }),
        caps,
        baseEnv,
        // appliesNodeMemoryCap omitted => false => the shell-runner contract.
      });
      const memNote = h.effective.notes.find(
        (n) => n.layer === "resources" && n.note.includes("memoryBytes"),
      );
      expect(memNote).toBeDefined();
      // And memory is never surfaced as a fatal downgrade for shell.
      expect(
        h.effective.downgrades.some(
          (d) => d.layer === "resources" && d.reason.includes("memory"),
        ),
      ).toBe(false);
    }
  });

  it("emits no memory note when no memory cap is requested", () => {
    const policy = sandboxPolicySchema.parse({
      onUnavailable: "degrade",
      resources: { maxOutputBytes: 1024 },
      network: { mode: "unrestricted", denyLinkLocalAndMetadata: false },
      privilege: { mode: "inherit" },
    });
    const h = buildSpawnHardening({
      policy,
      caps: LINUX_NONROOT_BWRAP,
      baseEnv,
      appliesNodeMemoryCap: false,
    });
    expect(h.effective.notes.find((n) => n.layer === "resources")).toBeUndefined();
  });
});

describe("buildSpawnHardening — onUnavailable: fail", () => {
  it("throws SandboxUnavailableError before spawn on a degraded host", () => {
    const policy = sandboxPolicySchema.parse({
      ...DEFAULT_SANDBOX_PROFILE,
      onUnavailable: "fail",
    });
    expect(() =>
      buildSpawnHardening({ policy, caps: MACOS_NONE, baseEnv }),
    ).toThrow(SandboxUnavailableError);
  });

  it("does NOT throw when everything is enforceable", () => {
    // A policy that only requests output truncation + inherit privilege is
    // fully enforceable everywhere.
    const policy = sandboxPolicySchema.parse({
      onUnavailable: "fail",
      resources: { maxOutputBytes: 1024 },
      network: { mode: "unrestricted", denyLinkLocalAndMetadata: false },
    });
    expect(() =>
      buildSpawnHardening({ policy, caps: MACOS_NONE, baseEnv }),
    ).not.toThrow();
  });
});

describe("buildSpawnHardening — live netns probe verdict (Item 3)", () => {
  // A bwrap host where the LIVE clone probe SUCCEEDED: netNamespaces +
  // userNsCreatable are true, so a fresh-netns deny is genuinely deliverable.
  const PROBE_TRUE: SandboxCapabilities = {
    ...LINUX_NONROOT_BWRAP,
    userNamespaces: true,
    userNsCreatable: true,
    netNamespaces: true,
  };
  // The SAME bwrap host, but the live clone(CLONE_NEWUSER|CLONE_NEWNET) probe
  // FAILED (e.g. default Docker seccomp blocks the clone even though a wrapper
  // is on PATH). capabilities.ts derives netNamespaces=false + userNamespaces=
  // false from the live probe, so the wrapper cannot create the namespace.
  const PROBE_FALSE: SandboxCapabilities = {
    ...LINUX_NONROOT_BWRAP,
    userNamespaces: false,
    userNsCreatable: false,
    netNamespaces: false,
    netEgressRootless: false,
  };

  it("probe true -> network deny enforced (no downgrade)", () => {
    const policy = sandboxPolicySchema.parse({
      onUnavailable: "fail",
      filesystem: { mode: "off" },
      network: { mode: "deny", denyLinkLocalAndMetadata: true },
      privilege: { mode: "inherit" },
    });
    const h = buildSpawnHardening({
      policy,
      caps: PROBE_TRUE,
      baseEnv,
      filesystem: { scratchDir: "/tmp/scratch" },
    });
    expect(h.effective.enforced.network).toBe(true);
    expect(
      h.effective.downgrades.some((d) => d.layer === "network"),
    ).toBe(false);
  });

  it("probe false -> network NOT enforced + downgrade (fail-closed refuses)", () => {
    const policy = sandboxPolicySchema.parse({
      onUnavailable: "fail",
      filesystem: { mode: "off" },
      network: { mode: "deny", denyLinkLocalAndMetadata: true },
      privilege: { mode: "inherit" },
    });
    // Under fail-closed the run is REFUSED rather than falsely reported
    // enforced — the silent gap Item 3 closes (bwrap on PATH but the live clone
    // is blocked, so a routeless namespace cannot be created at spawn).
    expect(() =>
      buildSpawnHardening({
        policy,
        caps: PROBE_FALSE,
        baseEnv,
        filesystem: { scratchDir: "/tmp/scratch" },
      }),
    ).toThrow(SandboxUnavailableError);
  });

  it("probe false under degrade -> enforced.network false + surfaced downgrade", () => {
    const policy = sandboxPolicySchema.parse({
      onUnavailable: "degrade",
      filesystem: { mode: "off" },
      network: { mode: "deny", denyLinkLocalAndMetadata: true },
      privilege: { mode: "inherit" },
    });
    const h = buildSpawnHardening({
      policy,
      caps: PROBE_FALSE,
      baseEnv,
      filesystem: { scratchDir: "/tmp/scratch" },
    });
    expect(h.effective.enforced.network).toBe(false);
    expect(
      h.effective.downgrades.some((d) => d.layer === "network"),
    ).toBe(true);
  });
});
