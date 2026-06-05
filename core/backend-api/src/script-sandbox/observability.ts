import {
  detectSandboxCapabilities,
  type SandboxCapabilities,
} from "./capabilities";
import { buildSpawnHardening } from "./wrapper";
import { pickSafeEnv } from "./env-guard";
import {
  resolveDefaultSandboxProfile,
  type SandboxPolicy,
} from "./policy";
import type { EffectiveSandbox } from "./report";

/**
 * Observability for the script sandbox (plan §5.7 / Phase 4).
 *
 * Two surfaces:
 *  1. A single startup capability-log line per pod/satellite so operators can
 *     see what THIS host actually enforces for the configured global default
 *     (capability detection is per-host and may legitimately differ between a
 *     Linux pod and a macOS satellite — see {@link SandboxCapabilities}).
 *  2. A compact per-run downgrade summary the call sites log (and may surface
 *     in the run record) whenever a layer degraded, so a degradation is never
 *     silent.
 */

/** A logger surface narrow enough for the test mocks but matching the real one. */
export interface SandboxLogger {
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
}

/**
 * Human-readable summary of what a host can enforce, derived purely from its
 * detected capabilities. Exported so tests can assert the shape without
 * scraping a log string.
 */
export function summarizeCapabilities(
  caps: SandboxCapabilities,
): Record<string, string | boolean | null> {
  return {
    platform: caps.platform,
    // The supervisor's euid. The shipped images run NON-root (false here): the
    // script then inherits non-root by construction and can never be host-root.
    // A root supervisor (true) relies on the namespace wrapper's `--uid` to
    // drop. Reported as-is so operators can see which model this host uses.
    supervisorEuidIsRoot: caps.euidIsRoot,
    rlimits: caps.rlimitNative,
    wrapper: caps.wrapper,
    // userNamespaces is now the LIVE clone verdict (not the static sysctl), so
    // operators see what actually works on this host. userNsCreatable is the
    // same probe surfaced explicitly for the capability log.
    userNamespaces: caps.userNamespaces,
    userNsCreatable: caps.userNsCreatable,
    netNamespaces: caps.netNamespaces,
    netEgressIface: caps.netEgressIface,
    netEgressRootless: caps.netEgressRootless,
  };
}

/**
 * Compute the effective enforcement for a given global default on THIS host,
 * by running the (pure, synchronous) hardening builder against the detected
 * capabilities. No spawn, no I/O — used only to report at startup.
 */
export function describeEffectiveDefault({
  policy,
  caps,
}: {
  policy: SandboxPolicy;
  caps: SandboxCapabilities;
}): EffectiveSandbox {
  // The builder may throw under `onUnavailable: "fail"`; the startup probe must
  // never throw, so force a degrade-mode copy purely for reporting.
  const reportPolicy: SandboxPolicy = { ...policy, onUnavailable: "degrade" };
  const hardening = buildSpawnHardening({
    policy: reportPolicy,
    caps,
    baseEnv: pickSafeEnv(),
  });
  return hardening.effective;
}

/**
 * Emit the one-time startup capability log line for this pod/satellite. Logs
 * the detected primitives AND the effective enforcement of the supplied global
 * default (so operators see "what my host actually does", not just "what I
 * asked for"). Falls back to the shipped safe default when no global default is
 * supplied.
 */
export function logSandboxCapabilitiesAtStartup({
  logger,
  globalDefault,
  caps = detectSandboxCapabilities(),
}: {
  logger: SandboxLogger;
  globalDefault?: SandboxPolicy;
  caps?: SandboxCapabilities;
}): void {
  const policy = globalDefault ?? resolveDefaultSandboxProfile();
  const effective = describeEffectiveDefault({ policy, caps });
  logger.info("script sandbox capabilities", {
    capabilities: summarizeCapabilities(caps),
    enabled: policy.enabled,
    enforced: effective.enforced,
    downgrades: effective.downgrades,
  });
}

/**
 * Build a compact, loggable summary of the per-run downgrades, or `undefined`
 * when every requested layer was fully enforced (nothing to surface). The call
 * sites log this as a structured warning and may attach it to the run record so
 * an operator can see, per run, which layer degraded and why (e.g. the
 * metadata block being unenforceable on a bwrap-only host).
 */
export function summarizeRunDowngrades(
  effective: EffectiveSandbox | undefined,
): { layers: string[]; reasons: Record<string, string>; platform: string } | undefined {
  if (effective === undefined || effective.downgrades.length === 0) {
    return undefined;
  }
  const reasons: Record<string, string> = {};
  for (const d of effective.downgrades) {
    // Last reason per layer wins; layers can have at most a couple of entries.
    reasons[d.layer] = d.reason;
  }
  return {
    layers: effective.downgrades.map((d) => d.layer),
    reasons,
    platform: effective.platform,
  };
}

/**
 * Surface per-run sandbox downgrades through the supplied logger as a single
 * structured warning. A no-op when the run was fully enforced. Centralized so
 * every call site surfaces degradation identically (plan §5.7: degrade
 * surfaces, never hides).
 */
export function surfaceRunDowngrades({
  logger,
  effective,
}: {
  logger: SandboxLogger;
  effective: EffectiveSandbox | undefined;
}): void {
  const summary = summarizeRunDowngrades(effective);
  if (summary !== undefined) {
    logger.warn(
      `script sandbox degraded: ${summary.layers.join(", ")} not fully enforced on ${summary.platform}`,
      summary.reasons,
    );
  }
  // Non-fatal notes (e.g. shell per-run memory bounded by the cgroup, or
  // RLIMIT_NPROC not applied under a non-root supervisor) are surfaced at INFO,
  // separate from downgrades: they are accepted, expected states, not failures
  // to enforce the requested policy.
  if (effective !== undefined && effective.notes.length > 0) {
    const noteReasons: Record<string, string> = {};
    for (const n of effective.notes) {
      noteReasons[n.layer] = n.note;
    }
    logger.info(
      `script sandbox notes (${effective.notes.map((n) => n.layer).join(", ")}) on ${effective.platform}`,
      noteReasons,
    );
  }
}
