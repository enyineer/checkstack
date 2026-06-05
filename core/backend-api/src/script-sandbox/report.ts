import type { SandboxPolicy } from "./policy";

/**
 * The set of sandbox layers. Used as keys in the enforced/downgrade maps so
 * the surfaced report names layers consistently.
 */
export type SandboxLayer =
  | "resources"
  | "filesystem"
  | "network"
  | "privilege";

/** Which layers are actually enforced for a given run. */
export interface EnforcedLayers {
  resources: boolean;
  filesystem: boolean;
  network: boolean;
  privilege: boolean;
}

/** A single layer that could not be enforced as requested. */
export interface SandboxDowngrade {
  layer: SandboxLayer;
  reason: string;
}

/**
 * A NON-FATAL informational note about how a layer is enforced for this run.
 *
 * Unlike {@link SandboxDowngrade}, a note NEVER triggers the fail-closed gate
 * (`onUnavailable: "fail"`). It records an accepted, expected enforcement
 * characteristic that an operator should be aware of but that is NOT a failure
 * to enforce the requested policy.
 *
 * The motivating case: SHELL scripts have no per-run memory enforcement. The
 * ESM JS-heap cap (`NODE_OPTIONS=--max-old-space-size`) is consumed only by the
 * ESM runner; the shell runner never applies it, so a shell run's memory
 * ceiling is purely the container cgroup (Docker `--memory` / k8s
 * `resources.limits.memory`). That is a legitimate ceiling, not a missing
 * layer: refusing every shell run under fail-closed because of it would break
 * all shell health-checks and automation. So it is surfaced as a note rather
 * than overloaded onto `downgrades` (which fail-close).
 */
export interface SandboxNote {
  layer: SandboxLayer;
  note: string;
}

/**
 * What the sandbox actually did for a run, attached to the run result so call
 * sites can log/surface it. `downgrades` is empty when every requested layer
 * was fully enforced; otherwise it names each dropped layer and why.
 */
export interface EffectiveSandbox {
  /** The policy that was requested (fully resolved, post-merge). */
  requested: SandboxPolicy;
  /** Which layers are actually enforced on this host. */
  enforced: EnforcedLayers;
  /** Layers that were requested but degraded to the portable subset. */
  downgrades: SandboxDowngrade[];
  /**
   * Non-fatal informational notes about HOW a layer is enforced (e.g. shell
   * memory bounded by the cgroup rather than per-run). Never triggers
   * fail-closed; surfaced alongside downgrades so operators see the full
   * picture. Empty when there is nothing extra to surface.
   */
  notes: SandboxNote[];
  /** Host platform the run executed on. */
  platform: string;
}

/**
 * Thrown by the hardening builder when a requested layer cannot be enforced
 * and the policy's `onUnavailable` is `"fail"`. The runner catches this and
 * returns a clean failure result WITHOUT spawning an unsandboxed child.
 */
export class SandboxUnavailableError extends Error {
  readonly downgrades: SandboxDowngrade[];

  constructor(downgrades: SandboxDowngrade[]) {
    const summary = downgrades
      .map((d) => `${d.layer}: ${d.reason}`)
      .join("; ");
    super(`sandbox unavailable: ${summary}`);
    this.name = "SandboxUnavailableError";
    this.downgrades = downgrades;
  }
}
