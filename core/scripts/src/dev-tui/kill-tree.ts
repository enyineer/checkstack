/**
 * Cross-platform process-tree termination planning. Pure logic so it can be
 * unit-tested without spawning anything: it computes WHAT to run/signal, and
 * the supervisor executes the plan.
 *
 * - POSIX (linux/darwin): children are spawned with `detached: true`, which
 *   puts each in its own process group. Signaling the negative pid delivers
 *   the signal to the whole group, so `bun --watch` and its grandchildren die
 *   too (no orphans).
 * - Windows: there are no process groups; `taskkill /T` walks and kills the
 *   whole tree by pid.
 */

export type KillSignal = "SIGTERM" | "SIGKILL" | "SIGINT";

export type KillPlan =
  | {
      readonly kind: "signal";
      /** Negative pid to target the process group. */
      readonly target: number;
      readonly signal: KillSignal;
    }
  | {
      readonly kind: "spawn";
      readonly command: string;
      readonly args: readonly string[];
    };

export interface PlanKillInput {
  /** `process.platform` value. */
  platform: NodeJS.Platform;
  /** The child's pid (positive). */
  pid: number;
  /** Signal to send on POSIX; ignored on Windows (taskkill always force-kills). */
  signal?: KillSignal;
}

/**
 * Compute the platform-appropriate way to kill a child process and its entire
 * descendant tree.
 */
export function planKill({
  platform,
  pid,
  signal = "SIGTERM",
}: PlanKillInput): KillPlan {
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new Error(`planKill requires a positive integer pid, got ${pid}`);
  }

  if (platform === "win32") {
    return {
      kind: "spawn",
      command: "taskkill",
      args: ["/pid", String(pid), "/T", "/F"],
    };
  }

  return {
    kind: "signal",
    target: -pid,
    signal,
  };
}
