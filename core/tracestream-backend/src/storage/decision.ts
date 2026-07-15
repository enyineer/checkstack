/**
 * Pure tail-sampling DECISION policy. Given a settled trace's decision-relevant
 * summary fields and the stream's sampling config, decide whether the raw trace
 * is RETAINED (keep its spans) or dropped to summary only. Kept pure so the
 * DECISION job stays deterministic and idempotent: the same inputs always
 * produce the same verdict, so a re-run (BullMQ retry, another pod) reaches the
 * SAME conclusion without persisting a random draw.
 */

import type { TraceSamplingConfig } from "@checkstack/tracestream-common";
import { hashToUnitInterval } from "./hash";
import { floorToHour } from "./time";

/** The decision-relevant projection of a settled trace summary. */
export interface DecisionCandidate {
  traceId: string;
  hasError: boolean;
  durationMs: number;
  /** Trace start; buckets the trace into an hour for the retained-per-hour budget. */
  startTs: Date;
}

/** Why a trace was kept or dropped (drives the surfaced reasoning / logging). */
export type RetentionReason =
  | "error"
  | "slow"
  | "baseline"
  | "sampled_out"
  | "over_budget";

export interface RetentionVerdict {
  traceId: string;
  retained: boolean;
  reason: RetentionReason;
}

/**
 * Classify ONE trace against the sampling rules, BEFORE the per-hour budget:
 *
 * 1. error + `keepErrorTraces` => retain (`error`).
 * 2. `slowTraceThresholdMs` set and `durationMs >=` it => retain (`slow`).
 * 3. else retain iff `hashToUnitInterval(traceId) < baselineSampleRate`
 *    (`baseline`), otherwise drop (`sampled_out`).
 *
 * Pure and deterministic.
 */
export function classifyRetention({
  candidate,
  sampling,
}: {
  candidate: DecisionCandidate;
  sampling: TraceSamplingConfig;
}): RetentionVerdict {
  const { traceId, hasError, durationMs } = candidate;
  if (hasError && sampling.keepErrorTraces) {
    return { traceId, retained: true, reason: "error" };
  }
  if (
    sampling.slowTraceThresholdMs !== null &&
    durationMs >= sampling.slowTraceThresholdMs
  ) {
    return { traceId, retained: true, reason: "slow" };
  }
  if (hashToUnitInterval(traceId) < sampling.baselineSampleRate) {
    return { traceId, retained: true, reason: "baseline" };
  }
  return { traceId, retained: false, reason: "sampled_out" };
}

/**
 * Decide retention for a batch of settled traces, applying the sampling rules
 * then the optional `maxRetainedTracesPerHour` soft ceiling.
 *
 * BUDGET APPROACH: the cap is per stream per hour and is a SOFT ceiling that
 * only sheds baseline noise. Every retained trace (error, slow OR baseline)
 * counts toward its start-hour's tally, seeded from `retainedByHour` (the count
 * of already-decided-retained traces in that hour, read from the DB so the
 * budget holds across pages / pods). When an hour's tally has reached the cap,
 * further BASELINE-sampled traces in that hour are DEMOTED to `over_budget`;
 * error and slow traces are the signal and are NEVER demoted (so a burst of
 * errors may legitimately exceed the cap). Processing candidates in order means
 * the earliest baseline traces in a page win the remaining budget - baseline is
 * always what gets dropped first. Pure.
 */
export function decideRetention({
  candidates,
  sampling,
  retainedByHour,
}: {
  candidates: DecisionCandidate[];
  sampling: TraceSamplingConfig;
  /** epoch-ms of an hour start -> traces already retained in that hour. */
  retainedByHour?: Map<number, number>;
}): RetentionVerdict[] {
  const cap = sampling.maxRetainedTracesPerHour;
  const tally = new Map(retainedByHour);
  const out: RetentionVerdict[] = [];
  for (const candidate of candidates) {
    const base = classifyRetention({ candidate, sampling });
    if (!base.retained) {
      out.push(base);
      continue;
    }
    const hour = floorToHour(candidate.startTs).getTime();
    const used = tally.get(hour) ?? 0;
    if (cap !== null && base.reason === "baseline" && used >= cap) {
      out.push({
        traceId: base.traceId,
        retained: false,
        reason: "over_budget",
      });
      continue;
    }
    tally.set(hour, used + 1);
    out.push(base);
  }
  return out;
}
