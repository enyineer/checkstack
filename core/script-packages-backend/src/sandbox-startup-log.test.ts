import { describe, expect, it } from "bun:test";
import type { SandboxCapabilities, SandboxPolicy } from "@checkstack/backend-api";
import { resolveDefaultSandboxProfile } from "@checkstack/backend-api";
import { logSandboxStartupReadiness } from "./sandbox-startup-log";

/**
 * Linux capabilities with every OS-level primitive available, so
 * `assessSandboxHostReadiness` reports `enforceable: true`.
 */
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

/** A non-Linux host: OS-level isolation is not enforceable. */
const MACOS_HOST: SandboxCapabilities = {
  ...LINUX_READY,
  platform: "darwin",
};

interface LogCall {
  level: "info" | "warn" | "debug";
  message: string;
  args: unknown[];
}

function recordingLogger() {
  const calls: LogCall[] = [];
  return {
    calls,
    logger: {
      info: (message: string, ...args: unknown[]) =>
        calls.push({ level: "info", message, args }),
      warn: (message: string, ...args: unknown[]) =>
        calls.push({ level: "warn", message, args }),
      debug: (message: string, ...args: unknown[]) =>
        calls.push({ level: "debug", message, args }),
    },
  };
}

describe("logSandboxStartupReadiness", () => {
  it("reads the policy IN-PROCESS (no RPC) and logs the capability line", async () => {
    let reads = 0;
    const policy: SandboxPolicy = resolveDefaultSandboxProfile();
    const { logger, calls } = recordingLogger();

    await logSandboxStartupReadiness({
      logger,
      readPolicy: async () => {
        reads += 1;
        return policy;
      },
      caps: LINUX_READY,
    });

    // The policy was resolved through the supplied in-process reader, NOT an
    // RPC round-trip. This is the regression guard: the startup readiness log
    // no longer depends on the `getSandboxPolicy` route being mounted.
    expect(reads).toBe(1);

    const capabilityLog = calls.find(
      (c) => c.message === "script sandbox capabilities",
    );
    expect(capabilityLog).toBeDefined();
    expect(capabilityLog?.level).toBe("info");
  });

  it("does not throw when the in-process read fails (best-effort log)", async () => {
    const { logger, calls } = recordingLogger();

    await logSandboxStartupReadiness({
      logger,
      readPolicy: async () => {
        throw new Error("transient db error");
      },
      caps: LINUX_READY,
    });

    // A failed read must not crash startup; it warns and moves on. Crucially it
    // does NOT surface a "Not Found" / 404 (the old RPC failure mode).
    const warned = calls.find((c) => c.level === "warn");
    expect(warned).toBeDefined();
    expect(warned?.message).not.toContain("Not Found");
    expect(warned?.message).not.toContain("404");
  });

  it("emits the high-visibility readiness banner on a host that cannot enforce", async () => {
    const { logger, calls } = recordingLogger();

    await logSandboxStartupReadiness({
      logger,
      readPolicy: async () => resolveDefaultSandboxProfile(),
      caps: MACOS_HOST,
    });

    const banner = calls.find(
      (c) =>
        c.level === "warn" &&
        c.message.includes("OS-LEVEL ISOLATION UNAVAILABLE"),
    );
    expect(banner).toBeDefined();
  });

  it("logs the positive readiness line at debug on an enforceable host", async () => {
    const { logger, calls } = recordingLogger();

    await logSandboxStartupReadiness({
      logger,
      readPolicy: async () => resolveDefaultSandboxProfile(),
      caps: LINUX_READY,
    });

    const ok = calls.find(
      (c) => c.level === "debug" && c.message.includes("OS-level isolation"),
    );
    expect(ok).toBeDefined();
  });
});
