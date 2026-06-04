import { describe, expect, it } from "bun:test";
import type { SandboxCapabilities } from "./capabilities";
import {
  logSandboxCapabilitiesAtStartup,
  summarizeCapabilities,
  summarizeRunDowngrades,
  surfaceRunDowngrades,
} from "./observability";
import { DEFAULT_SANDBOX_PROFILE } from "./policy";
import type { EffectiveSandbox } from "./report";

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

const LINUX_FULL: SandboxCapabilities = {
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

function recordingLogger() {
  const infos: Array<{ message: string; args: unknown[] }> = [];
  const warns: Array<{ message: string; args: unknown[] }> = [];
  return {
    infos,
    warns,
    logger: {
      info(message: string, ...args: unknown[]) {
        infos.push({ message, args });
      },
      warn(message: string, ...args: unknown[]) {
        warns.push({ message, args });
      },
    },
  };
}

describe("summarizeCapabilities", () => {
  it("projects the detected primitives into a flat, loggable shape", () => {
    const s = summarizeCapabilities(LINUX_FULL);
    expect(s.platform).toBe("linux");
    expect(s.supervisorEuidIsRoot).toBe(true);
    expect(s.wrapper).toBe("nsjail");
    expect(s.netEgressIface).toBe("eth0");
  });
});

describe("logSandboxCapabilitiesAtStartup", () => {
  it("emits ONE info line with capabilities + effective enforcement", () => {
    const { infos, logger } = recordingLogger();
    logSandboxCapabilitiesAtStartup({
      logger,
      globalDefault: DEFAULT_SANDBOX_PROFILE,
      caps: LINUX_FULL,
    });
    expect(infos).toHaveLength(1);
    expect(infos[0]?.message).toContain("script sandbox capabilities");
  });

  it("never throws even for an onUnavailable:fail global default on a weak host", () => {
    const { logger } = recordingLogger();
    expect(() =>
      logSandboxCapabilitiesAtStartup({
        logger,
        globalDefault: { ...DEFAULT_SANDBOX_PROFILE, onUnavailable: "fail" },
        caps: MACOS_NONE,
      }),
    ).not.toThrow();
  });
});

describe("summarizeRunDowngrades", () => {
  it("returns undefined when fully enforced (nothing to surface)", () => {
    const effective: EffectiveSandbox = {
      requested: DEFAULT_SANDBOX_PROFILE,
      enforced: {
        resources: true,
        filesystem: true,
        network: true,
        privilege: true,
      },
      downgrades: [],
      notes: [],
      platform: "linux",
    };
    expect(summarizeRunDowngrades(effective)).toBeUndefined();
    expect(summarizeRunDowngrades(undefined)).toBeUndefined();
  });

  it("summarizes the degraded layers + reasons", () => {
    const effective: EffectiveSandbox = {
      requested: DEFAULT_SANDBOX_PROFILE,
      enforced: {
        resources: false,
        filesystem: false,
        network: false,
        privilege: false,
      },
      downgrades: [
        { layer: "network", reason: "metadata block unenforceable" },
        { layer: "filesystem", reason: "no wrapper" },
      ],
      notes: [],
      platform: "darwin",
    };
    const summary = summarizeRunDowngrades(effective);
    expect(summary?.layers).toEqual(["network", "filesystem"]);
    expect(summary?.reasons.network).toContain("metadata");
    expect(summary?.platform).toBe("darwin");
  });
});

describe("surfaceRunDowngrades", () => {
  it("logs a single structured warning when a layer degraded", () => {
    const { warns, logger } = recordingLogger();
    surfaceRunDowngrades({
      logger,
      effective: {
        requested: DEFAULT_SANDBOX_PROFILE,
        enforced: {
          resources: true,
          filesystem: false,
          network: false,
          privilege: true,
        },
        downgrades: [
          { layer: "filesystem", reason: "no wrapper on this host" },
        ],
        notes: [],
        platform: "darwin",
      },
    });
    expect(warns).toHaveLength(1);
    expect(warns[0]?.message).toContain("script sandbox degraded");
    expect(warns[0]?.message).toContain("filesystem");
  });

  it("is a no-op when the run was fully enforced (no downgrades, no notes)", () => {
    const { warns, infos, logger } = recordingLogger();
    surfaceRunDowngrades({
      logger,
      effective: {
        requested: DEFAULT_SANDBOX_PROFILE,
        enforced: {
          resources: true,
          filesystem: true,
          network: true,
          privilege: true,
        },
        downgrades: [],
        notes: [],
        platform: "linux",
      },
    });
    expect(warns).toHaveLength(0);
    expect(infos).toHaveLength(0);
  });

  it("logs non-fatal notes at INFO (separate from downgrades)", () => {
    const { warns, infos, logger } = recordingLogger();
    surfaceRunDowngrades({
      logger,
      effective: {
        requested: DEFAULT_SANDBOX_PROFILE,
        enforced: {
          resources: true,
          filesystem: true,
          network: true,
          privilege: true,
        },
        downgrades: [],
        notes: [
          {
            layer: "resources",
            note: "per-run memory (memoryBytes) is NOT enforced; cgroup is the ceiling",
          },
        ],
        platform: "linux",
      },
    });
    // A note is NOT a degradation: no warning, an INFO line instead.
    expect(warns).toHaveLength(0);
    expect(infos).toHaveLength(1);
    expect(infos[0]?.message).toContain("script sandbox notes");
    expect(infos[0]?.message).toContain("resources");
  });
});
