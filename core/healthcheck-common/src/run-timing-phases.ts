/**
 * Pure phase-builder for the per-run timing waterfall.
 *
 * Turns a run's optional structured `timings` (plus the legacy
 * `connectionTimeMs` / total `latencyMs`) into an ordered list of
 * `{ id, label, durationMs }` phases the frontend waterfall renders directly.
 *
 * Deliberately framework-free and side-effect-free so it can be unit-tested in
 * isolation. The frontend wraps the output into `WaterfallPhase[]` (the shape
 * matches), but this module owns ALL the "which phases exist" logic so the
 * fallback rules are tested once, here.
 *
 * Honesty rule: never fabricate a phase that was not measured. When granular
 * `timings` are present, render only the present phases in transport order.
 * When they are absent (old runs, single-phase strategies), fall back to the
 * coarse Connection + Processing split derived from `connectionTimeMs` and the
 * total - exactly the historical behaviour.
 */

import {
  RUN_TIMING_PHASE_LABELS,
  RUN_TIMING_PHASE_ORDER,
  type RunTimings,
} from "./schemas";

/** One built phase: matches the UI `WaterfallPhase` contract. */
export interface TimingPhase {
  /** Stable id (also used for React keys). */
  id: string;
  /** Human label, e.g. "DNS". */
  label: string;
  /** Duration in milliseconds (>= 0). */
  durationMs: number;
}

/** Map a timing key (e.g. `dnsMs`) to a stable phase id (e.g. `dns`). */
function phaseId(key: keyof RunTimings): string {
  return key.replace(/Ms$/, "").toLowerCase();
}

/**
 * Build the ordered waterfall phases for a single run.
 *
 * Resolution order:
 * 1. If `timings` holds at least one finite, positive phase, render those
 *    present phases in transport order (DNS -> connect -> TLS -> wait ->
 *    transfer -> processing). This is the granular path.
 * 2. Otherwise fall back to the coarse split: Connection
 *    (`min(connectionTimeMs, latencyMs)`) + Processing (`latencyMs -
 *    connectionTimeMs`, clamped at 0) - but only when BOTH `connectionTimeMs`
 *    and `latencyMs` are known.
 * 3. Otherwise return an empty list (the caller hides the waterfall).
 */
export function buildRunTimingPhases({
  timings,
  connectionTimeMs,
  latencyMs,
}: {
  timings?: RunTimings;
  connectionTimeMs?: number;
  latencyMs?: number;
}): TimingPhase[] {
  // 1. Granular path: at least one present, finite, positive phase.
  if (timings) {
    const granular: TimingPhase[] = [];
    for (const key of RUN_TIMING_PHASE_ORDER) {
      const value = timings[key];
      if (typeof value === "number" && Number.isFinite(value) && value > 0) {
        granular.push({
          id: phaseId(key),
          label: RUN_TIMING_PHASE_LABELS[key],
          durationMs: value,
        });
      }
    }
    if (granular.length > 0) {
      return granular;
    }
  }

  // 2. Coarse fallback: Connection + Processing (legacy 2-phase view).
  if (
    typeof connectionTimeMs === "number" &&
    Number.isFinite(connectionTimeMs) &&
    typeof latencyMs === "number" &&
    Number.isFinite(latencyMs)
  ) {
    return [
      {
        id: "connection",
        label: "Connection",
        durationMs: Math.min(connectionTimeMs, latencyMs),
      },
      {
        id: "processing",
        label: "Processing",
        durationMs: Math.max(0, latencyMs - connectionTimeMs),
      },
    ];
  }

  // 3. Nothing to show.
  return [];
}

/**
 * Whether the built phases came from the granular `timings` breakdown (vs the
 * coarse 2-phase fallback). Drives the explanatory note in the UI.
 */
export function hasGranularTimings(timings?: RunTimings): boolean {
  if (!timings) return false;
  return RUN_TIMING_PHASE_ORDER.some((key) => {
    const value = timings[key];
    return typeof value === "number" && Number.isFinite(value) && value > 0;
  });
}
