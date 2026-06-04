import type { SystemSignal, SystemSignalTone } from "@checkstack/catalog-common";

/**
 * Severity sort weight. Lower sorts first, so a system's worst signal (and the
 * problem cards themselves) read error -> warn -> info, matching the icon-only
 * `StatusBadge` ordering used everywhere else.
 */
export const TONE_WEIGHT: Record<SystemSignalTone, number> = {
  error: 0,
  warn: 1,
  info: 2,
};

/** A system that has at least one signal, with derived sort/grouping metadata. */
export interface ProblemSystem {
  systemId: string;
  /** All signals for the system, sorted worst-first. */
  signals: SystemSignal[];
  /** The most severe tone present (drives the card accent + the header counts). */
  worstTone: SystemSignalTone;
  /** Number of distinct signals (tie-break: more problems sort higher). */
  signalCount: number;
  /** Earliest `since` across the system's signals (tie-break: longest-suffering first). */
  oldestSince?: string;
}

/** Per-source signal maps, keyed by the source id reported through `onSignals`. */
export type SignalsBySource = Record<
  string,
  Record<string, SystemSignal[]>
>;

/** Merge every source's per-system map into one per-system-id signal list. */
export function mergeSignalsBySystem(
  bySource: SignalsBySource,
): Record<string, SystemSignal[]> {
  const merged: Record<string, SystemSignal[]> = {};
  for (const map of Object.values(bySource)) {
    for (const [systemId, signals] of Object.entries(map)) {
      if (!signals || signals.length === 0) continue;
      (merged[systemId] ??= []).push(...signals);
    }
  }
  return merged;
}

function sinceMs(since: string | undefined): number {
  if (!since) return Number.POSITIVE_INFINITY;
  const ms = Date.parse(since);
  return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : ms;
}

/** Sort a single system's signals worst-tone-first, then oldest-first. */
export function sortSignals(signals: SystemSignal[]): SystemSignal[] {
  return signals.toSorted((a, b) => {
    const tone = TONE_WEIGHT[a.tone] - TONE_WEIGHT[b.tone];
    if (tone !== 0) return tone;
    return sinceMs(a.since) - sinceMs(b.since);
  });
}

/**
 * Turn the merged per-system signal map into a sorted list of problem systems.
 * Sort order: worst tone first, then more signals first, then oldest first.
 * Systems with no signals never appear (healthy systems are hidden).
 */
export function buildProblemSystems(
  merged: Record<string, SystemSignal[]>,
): ProblemSystem[] {
  const problems: ProblemSystem[] = [];

  for (const [systemId, rawSignals] of Object.entries(merged)) {
    if (rawSignals.length === 0) continue;
    const signals = sortSignals(rawSignals);
    const oldest = Math.min(...signals.map((s) => sinceMs(s.since)));
    problems.push({
      systemId,
      signals,
      worstTone: signals[0].tone,
      signalCount: signals.length,
      oldestSince: Number.isFinite(oldest)
        ? new Date(oldest).toISOString()
        : undefined,
    });
  }

  return problems.toSorted((a, b) => {
    const tone = TONE_WEIGHT[a.worstTone] - TONE_WEIGHT[b.worstTone];
    if (tone !== 0) return tone;
    if (b.signalCount !== a.signalCount) return b.signalCount - a.signalCount;
    return sinceMs(a.oldestSince) - sinceMs(b.oldestSince);
  });
}

export interface SeverityCounts {
  error: number;
  warn: number;
  info: number;
}

/** Count problem systems by their worst tone (each system counted once). */
export function countByTone(problems: ProblemSystem[]): SeverityCounts {
  const counts: SeverityCounts = { error: 0, warn: 0, info: 0 };
  for (const problem of problems) counts[problem.worstTone] += 1;
  return counts;
}
