import type {
  RibbonCell,
  RibbonStatus,
  SeriesPoint,
  WaterfallPhase,
} from "../../src/components/charts";

/**
 * Deterministic pseudo-random so stories are stable across reloads. A small
 * LCG is plenty for jittering sample data and stays lint-clean (no bit ops).
 */
function seededRandom(seed: number): () => number {
  let state = (seed % 2_147_483_647) + 1;
  return () => {
    state = (state * 48_271) % 2_147_483_647;
    return (state - 1) / 2_147_483_646;
  };
}

const HOUR = 60 * 60 * 1000;
const BASE = Date.UTC(2026, 5, 15, 0, 0, 0);

/** A jagged but bounded latency series (raw buckets, on purpose not smooth). */
export function latencySeries({
  points = 48,
  base = 120,
  jitter = 40,
  seed = 7,
}: {
  points?: number;
  base?: number;
  jitter?: number;
  seed?: number;
} = {}): SeriesPoint[] {
  const rand = seededRandom(seed);
  return Array.from({ length: points }, (_, i) => ({
    x: BASE + i * (HOUR / 2),
    y: Math.round(base + (rand() - 0.5) * 2 * jitter + Math.sin(i / 4) * 12),
  }));
}

/** A p95 envelope sitting above the p50 series. */
export function p95Series({
  p50,
  uplift = 80,
  seed = 11,
}: {
  p50: SeriesPoint[];
  uplift?: number;
  seed?: number;
}): SeriesPoint[] {
  const rand = seededRandom(seed);
  return p50.map((p) => ({
    x: p.x,
    y: p.y === null ? null : Math.round(p.y + uplift + rand() * 30),
  }));
}

/** A column of small numbers for a sparkline. */
export function sparkValues({
  points = 24,
  base = 50,
  drift = 0.6,
  jitter = 6,
  seed = 3,
}: {
  points?: number;
  base?: number;
  drift?: number;
  jitter?: number;
  seed?: number;
} = {}): number[] {
  const rand = seededRandom(seed);
  return Array.from({ length: points }, (_, i) =>
    Math.round(base + i * drift + (rand() - 0.5) * 2 * jitter),
  );
}

/** A realistic single-run request timing waterfall (Wait is the bottleneck). */
export const sampleWaterfall: WaterfallPhase[] = [
  { id: "dns", label: "DNS", durationMs: 12 },
  { id: "tcp", label: "TCP", durationMs: 37 },
  { id: "tls", label: "TLS", durationMs: 59 },
  { id: "req", label: "Request", durationMs: 4 },
  { id: "wait", label: "Wait (TTFB)", durationMs: 271 },
  { id: "transfer", label: "Transfer", durationMs: 33 },
];

/** A mostly-healthy 90-day ribbon with a couple of incidents. */
export function uptimeCells({
  days = 90,
  seed = 5,
}: {
  days?: number;
  seed?: number;
} = {}): RibbonCell[] {
  const rand = seededRandom(seed);
  const incidents = new Map<number, RibbonStatus>([
    [23, "down"],
    [24, "warn"],
    [61, "warn"],
  ]);
  return Array.from({ length: days }, (_, i) => {
    const status: RibbonStatus = incidents.get(i) ?? (rand() > 0.97 ? "warn" : "ok");
    return { id: `day-${i}`, status, label: `Day ${i + 1}` };
  });
}
