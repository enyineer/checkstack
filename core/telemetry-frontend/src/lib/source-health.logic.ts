import type { TelemetrySource } from "@checkstack/telemetry-common";

/**
 * The per-row health view for a source instance, derived from the backend's
 * run bookkeeping (`consecutiveFailures` / `lastError` / `lastRunAt`). Kept
 * pure so the failing/relative-time decisions are unit-testable without React.
 */
export interface SourceHealthView {
  /** True when the last run(s) failed - drives the destructive badge. */
  failing: boolean;
  /** Absolute consecutive-failure counter from the backend. */
  consecutiveFailures: number;
  /** Last run's error message (tooltip on the failing badge), if any. */
  lastError: string | null;
  /**
   * Whether the timestamp below reflects an actual run (`ran`) or falls back
   * to the row's last update when the source has never run (`updated`).
   */
  timeLabel: "ran" | "updated";
  /** The timestamp to render as relative time. */
  timeAt: Date;
}

export function deriveSourceHealth(source: TelemetrySource): SourceHealthView {
  return {
    failing: source.consecutiveFailures > 0,
    consecutiveFailures: source.consecutiveFailures,
    lastError: source.lastError,
    timeLabel: source.lastRunAt ? "ran" : "updated",
    timeAt: source.lastRunAt ?? source.updatedAt,
  };
}

/**
 * Liveness view for a PUSH source, which has no poll schedule: `lastRunAt` is
 * stamped only when verified telemetry is received. So "has it ever received?"
 * and "when last?" are the meaningful signals, rendered as a "last received"
 * hint instead of the pull/run "Ran/Updated" timestamp.
 */
export interface PushLivenessView {
  /** True once verified ingest has stamped `lastRunAt`. */
  received: boolean;
  /** Timestamp of the last received push, or `null` if none yet. */
  receivedAt: Date | null;
}

export function derivePushLiveness(source: TelemetrySource): PushLivenessView {
  return {
    received: source.lastRunAt !== null,
    receivedAt: source.lastRunAt,
  };
}
