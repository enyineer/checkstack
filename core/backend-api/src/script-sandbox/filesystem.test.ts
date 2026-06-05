import { describe, expect, it } from "bun:test";
import type { SandboxCapabilities } from "./capabilities";
import { buildFilesystemLayer } from "./filesystem";
import { filesystemPolicySchema } from "./policy";

const LINUX_BWRAP: SandboxCapabilities = {
  platform: "linux",
  euidIsRoot: false,
  hasPrlimit: true,
  rlimitNative: true,
  wrapper: "bwrap",
  userNamespaces: true,
  userNsCreatable: true,
  netNamespaces: true,
  netEgressIface: null,
  netEgressAddressing: null,
  netEgressRootless: false,
};

const LINUX_NSJAIL: SandboxCapabilities = {
  ...LINUX_BWRAP,
  wrapper: "nsjail",
  netEgressIface: "eth0",
  netEgressAddressing: {
    ip: "10.0.0.2",
    netmask: "255.255.255.0",
    gateway: "10.0.0.1",
  },
};

const LINUX_NO_WRAPPER: SandboxCapabilities = {
  ...LINUX_BWRAP,
  wrapper: null,
  netNamespaces: false,
};

const LINUX_FIREJAIL: SandboxCapabilities = {
  ...LINUX_BWRAP,
  wrapper: "firejail",
};

const LINUX_NO_USERNS: SandboxCapabilities = {
  ...LINUX_BWRAP,
  userNamespaces: false,
  userNsCreatable: false,
  netNamespaces: false,
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

// All paths exist by default; tests override per-case.
const allExist = () => true;

function fsPolicy(input: unknown) {
  return filesystemPolicySchema.parse(input);
}

describe("buildFilesystemLayer — off", () => {
  it("returns off (no prelude) for mode=off regardless of host", () => {
    const r = buildFilesystemLayer({
      policy: fsPolicy({ mode: "off" }),
      caps: MACOS,
      inputs: {},
      pathExists: allExist,
    });
    expect(r.kind).toBe("off");
  });
});

describe("buildFilesystemLayer — bwrap scratch-only", () => {
  const r = buildFilesystemLayer({
    policy: fsPolicy({ mode: "scratch-only" }),
    caps: LINUX_BWRAP,
    inputs: { scratchDir: "/tmp/run-1" },
    pathExists: allExist,
  });

  it("builds a bwrap prelude", () => {
    expect(r.kind).toBe("enforced");
    if (r.kind !== "enforced") throw new Error("expected enforced");
    expect(r.prelude[0]).toBe("bwrap");
    expect(r.prelude).toContain("--unshare-all");
    // Network is a SEPARATE layer; FS isolation must keep host net.
    expect(r.prelude).toContain("--share-net");
  });

  it("binds the scratch dir read-write and chdirs into it", () => {
    if (r.kind !== "enforced") throw new Error("expected enforced");
    const joined = r.prelude.join(" ");
    expect(joined).toContain("--bind /tmp/run-1 /tmp/run-1");
    expect(joined).toContain("--chdir /tmp/run-1");
    expect(r.prelude[r.prelude.length - 1]).toBe("--");
  });

  it("ro-binds the base system but NOT node_modules under scratch-only", () => {
    if (r.kind !== "enforced") throw new Error("expected enforced");
    const joined = r.prelude.join(" ");
    expect(joined).toContain("--ro-bind /usr /usr");
    expect(joined).not.toContain("node_modules");
  });
});

describe("buildFilesystemLayer — privilege drop carried by the wrapper", () => {
  it("emits bwrap --uid/--gid when a drop target is supplied", () => {
    const r = buildFilesystemLayer({
      policy: fsPolicy({ mode: "scratch-only" }),
      caps: LINUX_BWRAP,
      inputs: { scratchDir: "/tmp/run-uid", dropUid: 65532, dropGid: 65532 },
      pathExists: allExist,
    });
    if (r.kind !== "enforced") throw new Error("expected enforced");
    const joined = r.prelude.join(" ");
    expect(joined).toContain("--uid 65532");
    expect(joined).toContain("--gid 65532");
  });

  it("emits nsjail --user/--group when a drop target is supplied", () => {
    const r = buildFilesystemLayer({
      policy: fsPolicy({ mode: "scratch-only" }),
      caps: LINUX_NSJAIL,
      inputs: { scratchDir: "/tmp/run-uid2", dropUid: 65532, dropGid: 65532 },
      pathExists: allExist,
    });
    if (r.kind !== "enforced") throw new Error("expected enforced");
    const joined = r.prelude.join(" ");
    expect(joined).toContain("--user 65532");
    expect(joined).toContain("--group 65532");
  });

  it("omits the uid drop when no target is supplied", () => {
    const r = buildFilesystemLayer({
      policy: fsPolicy({ mode: "scratch-only" }),
      caps: LINUX_BWRAP,
      inputs: { scratchDir: "/tmp/run-nouid" },
      pathExists: allExist,
    });
    if (r.kind !== "enforced") throw new Error("expected enforced");
    expect(r.prelude).not.toContain("--uid");
  });
});

describe("buildFilesystemLayer — bwrap scratch-plus-ro", () => {
  it("ro-binds the reconciled node_modules tree", () => {
    const r = buildFilesystemLayer({
      policy: fsPolicy({ mode: "scratch-plus-ro" }),
      caps: LINUX_BWRAP,
      inputs: {
        scratchDir: "/tmp/run-2",
        nodeModulesDir: "/store/current/node_modules",
      },
      pathExists: allExist,
    });
    expect(r.kind).toBe("enforced");
    if (r.kind !== "enforced") throw new Error("expected enforced");
    expect(r.prelude.join(" ")).toContain(
      "--ro-bind /store/current/node_modules /store/current/node_modules",
    );
  });

  it("skips the node_modules bind when the tree does not exist on disk", () => {
    const r = buildFilesystemLayer({
      policy: fsPolicy({ mode: "scratch-plus-ro" }),
      caps: LINUX_BWRAP,
      inputs: {
        scratchDir: "/tmp/run-3",
        nodeModulesDir: "/store/missing/node_modules",
      },
      pathExists: (p) => p !== "/store/missing/node_modules",
    });
    expect(r.kind).toBe("enforced");
    if (r.kind !== "enforced") throw new Error("expected enforced");
    expect(r.prelude.join(" ")).not.toContain("/store/missing/node_modules");
  });

  it("skips a base path that is absent on this distro (e.g. /lib64)", () => {
    const r = buildFilesystemLayer({
      policy: fsPolicy({ mode: "scratch-only" }),
      caps: LINUX_BWRAP,
      inputs: { scratchDir: "/tmp/run-4" },
      pathExists: (p) => p !== "/lib64",
    });
    if (r.kind !== "enforced") throw new Error("expected enforced");
    expect(r.prelude.join(" ")).not.toContain("--ro-bind /lib64");
  });
});

describe("buildFilesystemLayer — interpreter bind (P2 fix)", () => {
  it("ro-binds the realpath-resolved interpreter when outside the base paths", () => {
    const r = buildFilesystemLayer({
      policy: fsPolicy({ mode: "scratch-only" }),
      caps: LINUX_BWRAP,
      inputs: {
        scratchDir: "/tmp/run-int",
        interpreterPath: "/home/u/.bun/bin/bun",
      },
      pathExists: allExist,
      realpath: (p) => p, // identity for the test
    });
    if (r.kind !== "enforced") throw new Error("expected enforced");
    expect(r.prelude.join(" ")).toContain(
      "--ro-bind /home/u/.bun/bin/bun /home/u/.bun/bin/bun",
    );
  });

  it("does NOT double-bind an interpreter already under a base path", () => {
    const r = buildFilesystemLayer({
      policy: fsPolicy({ mode: "scratch-only" }),
      caps: LINUX_BWRAP,
      inputs: {
        scratchDir: "/tmp/run-int2",
        interpreterPath: "/usr/local/bin/bun",
      },
      pathExists: allExist,
      realpath: (p) => p,
    });
    if (r.kind !== "enforced") throw new Error("expected enforced");
    // /usr/local/bin/bun is under /usr (a RO base path) → no extra bind.
    const joined = r.prelude.join(" ");
    expect(joined).not.toContain("--ro-bind /usr/local/bin/bun");
  });

  it("nsjail ro-binds the interpreter too", () => {
    const r = buildFilesystemLayer({
      policy: fsPolicy({ mode: "scratch-only" }),
      caps: LINUX_NSJAIL,
      inputs: {
        scratchDir: "/tmp/run-int3",
        interpreterPath: "/opt/bun/bin/bun",
      },
      pathExists: allExist,
      realpath: (p) => p,
    });
    if (r.kind !== "enforced") throw new Error("expected enforced");
    expect(r.prelude.join(" ")).toContain(
      "--bindmount_ro /opt/bun/bin/bun:/opt/bun/bin/bun",
    );
  });
});

describe("buildFilesystemLayer — network composition (Phase 3)", () => {
  it("emits --unshare-net when the network decision is namespaced (bwrap)", () => {
    const r = buildFilesystemLayer({
      policy: fsPolicy({ mode: "scratch-only" }),
      caps: LINUX_BWRAP,
      inputs: { scratchDir: "/tmp/run-net1" },
      network: { kind: "namespaced", mode: "deny" },
      pathExists: allExist,
    });
    if (r.kind !== "enforced") throw new Error("expected enforced");
    expect(r.prelude).toContain("--unshare-net");
    expect(r.prelude).not.toContain("--share-net");
  });

  it("emits --share-net when the network decision keeps the host net", () => {
    const r = buildFilesystemLayer({
      policy: fsPolicy({ mode: "scratch-only" }),
      caps: LINUX_BWRAP,
      inputs: { scratchDir: "/tmp/run-net2" },
      network: { kind: "host", metadataBlockUnenforceable: false },
      pathExists: allExist,
    });
    if (r.kind !== "enforced") throw new Error("expected enforced");
    expect(r.prelude).toContain("--share-net");
  });

  it("nsjail plumbs macvlan + installs the nftables ruleset for a namespaced allowlist", () => {
    const r = buildFilesystemLayer({
      policy: fsPolicy({ mode: "off" }),
      caps: LINUX_NSJAIL,
      inputs: {},
      network: {
        kind: "namespaced",
        mode: "allowlist",
        egressIface: "eth0",
        egressAddressing: {
          ip: "10.0.0.2",
          netmask: "255.255.255.0",
          gateway: "10.0.0.1",
        },
        nftRuleset: "table inet ...",
      },
      nftRulesetPath: "/tmp/egress.nft",
      pathExists: allExist,
    });
    if (r.kind !== "enforced") throw new Error("expected enforced");
    expect(r.prelude).toContain("--clone_newnet");
    // Real uplink plumbed in so the allowed CIDR is reachable, not blackholed.
    expect(r.prelude).toContain("--macvlan_iface");
    expect(r.prelude).toContain("eth0");
    // The endpoint must be ADDRESSED or the macvlan still blackholes (P3 NIT).
    expect(r.prelude).toContain("--macvlan_vs_ip");
    expect(r.prelude).toContain("10.0.0.2");
    expect(r.prelude).toContain("--macvlan_vs_nm");
    expect(r.prelude).toContain("255.255.255.0");
    expect(r.prelude).toContain("--macvlan_vs_gw");
    expect(r.prelude).toContain("10.0.0.1");
    expect(r.prelude).toContain("--nftables_file");
    expect(r.prelude).toContain("/tmp/egress.nft");
    // FS off → host root bound so binaries still resolve.
    expect(r.prelude.join(" ")).toContain("--bindmount /:/");
  });

  it("deny is routeless: clone_newnet but NO macvlan uplink, NO ruleset", () => {
    const r = buildFilesystemLayer({
      policy: fsPolicy({ mode: "off" }),
      caps: LINUX_NSJAIL,
      inputs: {},
      network: { kind: "namespaced", mode: "deny" },
      pathExists: allExist,
    });
    if (r.kind !== "enforced") throw new Error("expected enforced");
    expect(r.prelude).toContain("--clone_newnet");
    expect(r.prelude).not.toContain("--macvlan_iface");
    expect(r.prelude).not.toContain("--nftables_file");
  });

  it("builds a network-only bwrap wrapper (FS off) binding the host root", () => {
    const r = buildFilesystemLayer({
      policy: fsPolicy({ mode: "off" }),
      caps: LINUX_BWRAP,
      inputs: {},
      network: { kind: "namespaced", mode: "deny" },
      pathExists: allExist,
    });
    if (r.kind !== "enforced") throw new Error("expected enforced");
    expect(r.prelude.join(" ")).toContain("--bind / /");
    expect(r.prelude).toContain("--unshare-net");
  });

  it("returns off when neither FS nor network needs a wrapper", () => {
    const r = buildFilesystemLayer({
      policy: fsPolicy({ mode: "off" }),
      caps: LINUX_BWRAP,
      inputs: {},
      network: { kind: "host", metadataBlockUnenforceable: false },
      pathExists: allExist,
    });
    expect(r.kind).toBe("off");
  });
});

describe("buildFilesystemLayer — nsjail", () => {
  it("builds an nsjail prelude with the equivalent bind set", () => {
    const r = buildFilesystemLayer({
      policy: fsPolicy({ mode: "scratch-plus-ro" }),
      caps: LINUX_NSJAIL,
      inputs: {
        scratchDir: "/tmp/run-5",
        nodeModulesDir: "/store/current/node_modules",
      },
      pathExists: allExist,
    });
    expect(r.kind).toBe("enforced");
    if (r.kind !== "enforced") throw new Error("expected enforced");
    expect(r.prelude[0]).toBe("nsjail");
    const joined = r.prelude.join(" ");
    expect(joined).toContain("--bindmount /tmp/run-5:/tmp/run-5");
    expect(joined).toContain(
      "--bindmount_ro /store/current/node_modules:/store/current/node_modules",
    );
    expect(joined).toContain("--cwd /tmp/run-5");
  });
});

describe("buildFilesystemLayer — degrade paths", () => {
  it("degrades on macOS (no Linux namespaces)", () => {
    const r = buildFilesystemLayer({
      policy: fsPolicy({ mode: "scratch-only" }),
      caps: MACOS,
      inputs: { scratchDir: "/tmp/x" },
      pathExists: allExist,
    });
    expect(r.kind).toBe("degrade");
    if (r.kind !== "degrade") throw new Error("expected degrade");
    expect(r.reason).toContain("platform=darwin");
  });

  it("degrades when unprivileged user namespaces are disabled", () => {
    const r = buildFilesystemLayer({
      policy: fsPolicy({ mode: "scratch-only" }),
      caps: LINUX_NO_USERNS,
      inputs: { scratchDir: "/tmp/x" },
      pathExists: allExist,
    });
    expect(r.kind).toBe("degrade");
    if (r.kind !== "degrade") throw new Error("expected degrade");
    expect(r.reason).toContain("user namespaces");
  });

  it("degrades when no namespace wrapper is on PATH", () => {
    const r = buildFilesystemLayer({
      policy: fsPolicy({ mode: "scratch-only" }),
      caps: LINUX_NO_WRAPPER,
      inputs: { scratchDir: "/tmp/x" },
      pathExists: allExist,
    });
    expect(r.kind).toBe("degrade");
    if (r.kind !== "degrade") throw new Error("expected degrade");
    expect(r.reason).toContain("bwrap/nsjail");
  });

  it("degrades on a firejail-only host (profile model unsupported)", () => {
    const r = buildFilesystemLayer({
      policy: fsPolicy({ mode: "scratch-only" }),
      caps: LINUX_FIREJAIL,
      inputs: { scratchDir: "/tmp/x" },
      pathExists: allExist,
    });
    expect(r.kind).toBe("degrade");
    if (r.kind !== "degrade") throw new Error("expected degrade");
    expect(r.reason).toContain("firejail");
  });

  it("degrades when the runner supplies no scratch dir", () => {
    const r = buildFilesystemLayer({
      policy: fsPolicy({ mode: "scratch-only" }),
      caps: LINUX_BWRAP,
      inputs: {},
      pathExists: allExist,
    });
    expect(r.kind).toBe("degrade");
    if (r.kind !== "degrade") throw new Error("expected degrade");
    expect(r.reason).toContain("scratch dir");
  });
});
