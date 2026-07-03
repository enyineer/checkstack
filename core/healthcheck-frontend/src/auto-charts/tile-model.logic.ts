/**
 * Pure model builder for the auto-generated metric tile grid: turns annotated
 * schema fields + aggregated buckets + anomaly baselines into ready-to-render
 * tile models (see `tile-model.logic.test.ts`). All extraction semantics from
 * the legacy per-type Recharts renderers live here, pinned by tests.
 */

import { format } from "date-fns";
import type {
  CategoryCell,
  DistributionSlice,
  RibbonCell,
  SeriesPoint,
} from "@checkstack/ui";
import { computeDelta, deltaSentiment } from "@checkstack/ui";
import type { AnomalyBaselineDto } from "@checkstack/anomaly-common";
import { readAssertionStats } from "@checkstack/healthcheck-common";
import type { ChartField } from "./schema-parser";
import { getFieldValue } from "./schema-parser";
import {
  booleanDominantLabels,
  deriveExpectedBand,
  deriveTrend,
  formatBaselineChips,
  formatDominantChip,
  isDominanceBaseline,
  matchBaseline,
  type BaselineChips,
  type ExpectedBand,
} from "./baseline.logic";

/** The rendering family a tile belongs to. */
export type TileKind =
  | "number"
  | "gauge"
  | "distribution"
  | "boolean"
  | "category"
  | "status";

const chartTypeToKind: Record<ChartField["chartType"], TileKind> = {
  line: "number",
  counter: "number",
  gauge: "gauge",
  bar: "distribution",
  pie: "distribution",
  boolean: "boolean",
  text: "category",
  status: "status",
};

/** Value tone for the tile's number (mirrors the status triad). */
export type TileTone = "ok" | "warn" | "down" | "unknown" | "default";

export interface TileDelta {
  direction: "up" | "down" | "flat";
  text: string;
  sentiment: "good" | "bad" | "neutral";
}

/** A ready-to-render tile for one annotated metric field. */
export interface TileModel {
  /** Stable key: `<instanceKey|strategy>:<field>`. */
  key: string;
  fieldName: string;
  label: string;
  unit: string;
  kind: TileKind;
  priority: number;
  /** Preformatted current/summary value, unit included. */
  latestText: string;
  tone: TileTone;
  delta?: TileDelta;
  /** Per-bucket numeric values for the collapsed sparkline (number/gauge). */
  sparkValues?: (number | null)[];
  /** Per-bucket time series for the expanded chart (number/gauge). */
  series?: SeriesPoint[];
  /** Per-bucket cells for boolean tiles. */
  boolCells?: RibbonCell[];
  /** Per-bucket cells for category (text) tiles. */
  categoryCells?: CategoryCell[];
  /** Distribution slices (bar/pie tiles). */
  slices?: DistributionSlice[];
  /** Gauge fill fraction 0..1 (gauge tiles). */
  gaugeFraction?: number;
  /** Expected/Trend chips from the anomaly baseline (numeric tiles). */
  baselineChips?: BaselineChips;
  /** Expected band for the expanded chart (numeric tiles). */
  expectedBand?: ExpectedBand;
  /** "Expected: <dominant>" chip (boolean/category tiles). */
  dominantChip?: string;
  /** True when the tile has an expanded chart body. */
  expandable: boolean;
}

/** The minimal bucket shape the tile builder reads. */
export interface TileBucket {
  bucketStart: string | Date;
  bucketEnd: string | Date;
  runCount: number;
  aggregatedResult?: unknown;
}

function timeLabel(bucket: TileBucket): string {
  return `${format(new Date(bucket.bucketStart), "MMM d, HH:mm")} - ${format(
    new Date(bucket.bucketEnd),
    "HH:mm",
  )}`;
}

function bucketValues({
  buckets,
  fieldName,
  instanceKey,
}: {
  buckets: ReadonlyArray<TileBucket>;
  fieldName: string;
  instanceKey?: string;
}): { value: unknown; bucket: TileBucket }[] {
  return buckets.map((bucket) => ({
    value: getFieldValue(
      bucket.aggregatedResult as Record<string, unknown> | undefined,
      fieldName,
      instanceKey,
    ),
    bucket,
  }));
}

/** Sum record values (e.g. statusCodeCounts) across buckets. */
function combineRecords(
  values: ReadonlyArray<unknown>,
): Record<string, number> {
  const combined: Record<string, number> = {};
  for (const value of values) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    for (const [key, count] of Object.entries(value)) {
      if (typeof count === "number") {
        combined[key] = (combined[key] || 0) + count;
      }
    }
  }
  return combined;
}

/** Count occurrences of each stringified simple value across buckets. */
function valueCounts(values: ReadonlyArray<unknown>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const key = String(value);
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

/** Format a numeric metric value: whole numbers plain, fractions 1 decimal. */
export function formatMetricValue({
  value,
  unit = "",
}: {
  value: number;
  unit?: string;
}): string {
  const text = Number.isInteger(value) ? String(value) : value.toFixed(1);
  return `${text}${unit}`;
}

function numberTile({
  field,
  points,
  sum,
}: {
  field: ChartField;
  points: SeriesPoint[];
  sum: number;
}): Pick<TileModel, "latestText" | "sparkValues" | "series" | "delta"> {
  const observed = points.filter((p) => p.y !== null);
  const latest = observed.at(-1)?.y ?? null;
  const previous = observed.at(-2)?.y ?? null;

  // Counters are totals over the window; everything else leads with the
  // latest bucket's value.
  const lead =
    field.chartType === "counter" ? sum : latest === null ? undefined : latest;

  let delta: TileDelta | undefined;
  if (field.chartType !== "counter") {
    const change = computeDelta({ previous, current: latest });
    if (change !== null && change.direction !== "flat") {
      const sign = change.direction === "up" ? "+" : "-";
      delta = {
        direction: change.direction,
        text: `${sign}${formatMetricValue({ value: change.absolute, unit: field.unit ?? "" })}`,
        sentiment: deltaSentiment({
          direction: change.direction,
          goodDirection: field.goodDirection,
        }),
      };
    }
  }

  return {
    latestText:
      lead === undefined
        ? "—"
        : formatMetricValue({ value: lead, unit: field.unit ?? "" }),
    sparkValues: points.map((p) => p.y),
    series: points,
    delta,
  };
}

/** Gauge tone: thresholds honoring the metric's good direction. */
export function gaugeTone({
  value,
  goodDirection = "up",
}: {
  value: number;
  goodDirection?: "up" | "down";
}): TileTone {
  if (goodDirection === "down") {
    if (value <= 10) return "ok";
    if (value <= 30) return "warn";
    return "down";
  }
  if (value >= 90) return "ok";
  if (value >= 70) return "warn";
  return "down";
}

/**
 * Build the tile models for one collector instance (or the strategy level when
 * `instanceKey` is undefined) from its annotated fields.
 */
export function buildTileModels({
  fields,
  buckets,
  baselines,
  instanceKey,
  rawFields,
}: {
  fields: ReadonlyArray<ChartField>;
  buckets: ReadonlyArray<TileBucket>;
  baselines: ReadonlyArray<AnomalyBaselineDto>;
  instanceKey?: string;
  /**
   * The RAW (per-run) schema fields, for annotations that live on the raw
   * field a baseline was learned on (e.g. `x-chart-true-label` of the
   * boolean behind an aggregated rate).
   */
  rawFields?: ReadonlyArray<ChartField>;
}): TileModel[] {
  const tiles: TileModel[] = [];

  // Prose labels for a boolean dominant: the raw field's explicit
  // x-chart-true/false-label annotations win; a humanized form of the field
  // name is the fallback.
  const dominantBooleanLabels = ({
    baseline,
    collectorId,
  }: {
    baseline: AnomalyBaselineDto;
    collectorId?: string;
  }) => {
    const fallback = booleanDominantLabels({ fieldPath: baseline.fieldPath });
    const rawFieldName = baseline.fieldPath.split(".").at(-1);
    const rawField = rawFields?.find(
      (f) => f.name === rawFieldName && f.collectorId === collectorId,
    );
    return {
      true: rawField?.trueLabel ?? fallback.true,
      false: rawField?.falseLabel ?? fallback.false,
    };
  };

  for (const field of fields) {
    const kind = chartTypeToKind[field.chartType];
    const unit = field.unit ?? "";
    const values = bucketValues({
      buckets,
      fieldName: field.name,
      instanceKey,
    });
    const baseline = matchBaseline({
      baselines,
      fieldName: field.name,
      collectorId: field.collectorId,
    });

    const base: TileModel = {
      key: `${instanceKey ?? "strategy"}:${field.name}`,
      fieldName: field.name,
      label: field.label,
      unit,
      kind,
      priority: field.priority,
      latestText: "—",
      tone: "default",
      expandable: false,
    };

    switch (kind) {
      case "number": {
        const points: SeriesPoint[] = [];
        let sum = 0;
        for (const { value, bucket } of values) {
          if (typeof value !== "number") continue;
          points.push({ x: new Date(bucket.bucketStart).getTime(), y: value });
          sum += value;
        }
        if (points.length === 0) break;
        Object.assign(
          base,
          numberTile({ field, points, sum }),
        );
        const band = deriveExpectedBand({
          baseline,
          buckets: buckets.map((b) => ({ runCount: b.runCount })),
        });
        base.expectedBand = band;
        base.baselineChips = formatBaselineChips({
          band,
          trend: deriveTrend({ baseline }),
          unit,
          decimals: 1,
        });
        base.expandable = true;
        break;
      }

      case "gauge": {
        const points: SeriesPoint[] = [];
        for (const { value, bucket } of values) {
          if (typeof value !== "number") continue;
          points.push({ x: new Date(bucket.bucketStart).getTime(), y: value });
        }
        const latest = points.at(-1)?.y;
        if (latest === undefined || latest === null) break;
        const clamped = Math.min(100, Math.max(0, latest));
        base.latestText = formatMetricValue({
          value: clamped,
          unit: field.unit ?? "%",
        });
        base.tone = gaugeTone({
          value: clamped,
          goodDirection: field.goodDirection,
        });
        base.gaugeFraction = clamped / 100;
        base.sparkValues = points.map((p) => p.y);
        base.series = points;
        // A dominance baseline (e.g. a success rate learned from a boolean
        // field) carries its signal in dominantValue/dominantRatio - its
        // mean/stdDev are 0, so the numeric band would read "Expected: 0.0%".
        // The chip names the dominant VALUE plus its historical share, with
        // boolean dominants rendered in prose ("Usually successful (98%)")
        // so the raw true/false never shows.
        if (isDominanceBaseline({ baseline })) {
          const chip = formatDominantChip({
            baseline,
            booleanLabels:
              baseline === undefined
                ? undefined
                : dominantBooleanLabels({
                    baseline,
                    collectorId: field.collectorId,
                  }),
          });
          base.baselineChips = chip === undefined ? {} : { expected: chip };
        } else {
          base.baselineChips = formatBaselineChips({
            band: deriveExpectedBand({
              baseline,
              buckets: buckets.map((b) => ({ runCount: b.runCount })),
            }),
            trend: deriveTrend({ baseline }),
            unit: field.unit ?? "%",
            decimals: 1,
          });
        }
        base.expandable = true;
        break;
      }

      case "distribution": {
        // Pre-aggregated records (statusCodeCounts) sum across buckets;
        // simple values (statusCode) fall back to occurrence counting.
        const rawValues = values.map((v) => v.value);
        const firstDefined = rawValues.find((v) => v !== undefined);
        const record =
          firstDefined &&
          typeof firstDefined === "object" &&
          !Array.isArray(firstDefined)
            ? combineRecords(rawValues)
            : valueCounts(rawValues);
        const slices = Object.entries(record).map(([label, value]) => ({
          id: label,
          label,
          value,
        }));
        if (slices.length === 0) break;
        let total = 0;
        let top: DistributionSlice = slices[0];
        for (const slice of slices) {
          total += slice.value;
          if (slice.value > top.value) top = slice;
        }
        base.latestText =
          slices.length > 1 && total > 0
            ? `${top.label} · ${Math.round((top.value / total) * 100)}%`
            : top.label;
        base.slices = slices;
        base.expandable = true;
        break;
      }

      case "boolean": {
        const cells: RibbonCell[] = [];
        for (const [i, { value, bucket }] of values.entries()) {
          if (typeof value !== "boolean") continue;
          cells.push({
            id: `${field.name}-${i}`,
            status: value ? "ok" : "down",
            label: `${timeLabel(bucket)}: ${value ? "Yes" : "No"}`,
          });
        }
        if (cells.length === 0) break;
        const latest = cells.at(-1)?.status === "ok";
        const trueCount = cells.filter((c) => c.status === "ok").length;
        const rate = Math.round((trueCount / cells.length) * 100);
        const mixed = trueCount > 0 && trueCount < cells.length;
        base.latestText = mixed
          ? `${latest ? "Yes" : "No"} · ${rate}% yes`
          : latest
            ? "Yes"
            : "No";
        base.tone = latest ? "ok" : "down";
        base.boolCells = cells;
        // The field's own prose labels when annotated, else the tile's
        // Yes/No value language.
        base.dominantChip = formatDominantChip({
          baseline,
          booleanLabels: {
            true: field.trueLabel ?? "Yes",
            false: field.falseLabel ?? "No",
          },
        });
        base.expandable = true;
        break;
      }

      case "category": {
        const cells: CategoryCell[] = [];
        for (const [i, { value, bucket }] of values.entries()) {
          if (typeof value !== "string") continue;
          cells.push({
            id: `${field.name}-${i}`,
            category: value,
            label: timeLabel(bucket),
          });
        }
        if (cells.length === 0) break;
        const latest = cells.at(-1)?.category ?? "—";
        const allSame = cells.every((c) => c.category === latest);
        base.latestText = latest || "—";
        base.tone = allSame ? "default" : "warn";
        base.categoryCells = cells;
        base.dominantChip = formatDominantChip({ baseline });
        base.expandable = true;
        break;
      }

      case "status": {
        const latest = values.at(-1)?.value;
        const hasValue =
          latest !== undefined && latest !== null && latest !== "";
        base.latestText = hasValue ? String(latest) : "No errors";
        base.tone = hasValue ? "down" : "default";
        break;
      }
    }

    tiles.push(base);
  }

  return orderTiles({ tiles });
}

/** Order tiles by ascending priority; equal priorities keep schema order. */
export function orderTiles({ tiles }: { tiles: TileModel[] }): TileModel[] {
  return tiles
    .map((tile, index) => ({ tile, index }))
    .toSorted(
      (a, b) => a.tile.priority - b.tile.priority || a.index - b.index,
    )
    .map(({ tile }) => tile);
}

/** One assertion series' tile for a collector instance. */
export interface AssertionTileModel {
  /** Stable render key: `<instanceKey>:<assertionKey>`. */
  key: string;
  /** Canonical assertion identity key. */
  assertionKey: string;
  /** e.g. `statusCode equals 200`. */
  label: string;
  /** Window pass rate, e.g. `99.4%` — or `—` before any data. */
  latestText: string;
  tone: TileTone;
  /** Per-bucket pass rate for the collapsed sparkline. */
  sparkValues: (number | null)[];
  /** Per-bucket pass/fail counts for the expanded StackedTimeline. */
  stacked: StackedBucketCounts[];
  totalPass: number;
  totalFail: number;
  /**
   * False when the series exists only in history (its configuring assertion
   * was edited away). Undefined when the config could not be read.
   */
  configured?: boolean;
}

/** Minimal stacked-bucket shape (mirrors the chart kit's StackedBucket). */
export interface StackedBucketCounts {
  start: number;
  end: number;
  counts: { ok: number; down: number };
}

/**
 * Build one tile per assertion series of a collector instance from the
 * buckets' per-assertion pass/fail stats. The series union is the CURRENTLY
 * configured assertions (shown even before any data arrives) plus any
 * historical-only series still present in the window's buckets.
 */
export function buildAssertionTileModels({
  buckets,
  instanceKey,
  configuredKeys,
  labelForKey,
}: {
  buckets: ReadonlyArray<TileBucket>;
  instanceKey: string;
  /** Canonical keys of the config's current assertions; undefined = unknown. */
  configuredKeys?: ReadonlyArray<string>;
  labelForKey: (props: { key: string }) => string;
}): AssertionTileModel[] {
  // Historical keys in window order of first appearance.
  const historicalKeys: string[] = [];
  const perBucketStats = buckets.map((bucket) => {
    const stats = readAssertionStats({
      aggregatedResult: bucket.aggregatedResult as
        | Record<string, unknown>
        | undefined,
    });
    const entryStats = stats?.[instanceKey];
    if (entryStats) {
      for (const key of Object.keys(entryStats)) {
        if (!historicalKeys.includes(key)) historicalKeys.push(key);
      }
    }
    return { bucket, entryStats };
  });

  const orderedKeys = [
    ...(configuredKeys ?? []),
    ...historicalKeys.filter((key) => !configuredKeys?.includes(key)),
  ];

  return orderedKeys.map((assertionKey) => {
    const sparkValues: (number | null)[] = [];
    const stacked: StackedBucketCounts[] = [];
    let totalPass = 0;
    let totalFail = 0;
    let latestFailing: boolean | undefined;

    for (const { bucket, entryStats } of perBucketStats) {
      const counts = entryStats?.[assertionKey];
      const start = new Date(bucket.bucketStart).getTime();
      const end = new Date(bucket.bucketEnd).getTime();
      if (counts === undefined) {
        // Pre-feature or no-data bucket: an honest gap, not a zero.
        sparkValues.push(null);
        stacked.push({ start, end, counts: { ok: 0, down: 0 } });
        continue;
      }
      const total = counts.passCount + counts.failCount;
      sparkValues.push(
        total === 0 ? null : Math.round((counts.passCount / total) * 1000) / 10,
      );
      stacked.push({
        start,
        end,
        counts: { ok: counts.passCount, down: counts.failCount },
      });
      totalPass += counts.passCount;
      totalFail += counts.failCount;
      if (total > 0) latestFailing = counts.failCount > 0;
    }

    const total = totalPass + totalFail;
    const passRate = total === 0 ? null : (totalPass / total) * 100;
    let tone: TileTone = "default";
    if (passRate !== null) {
      if (totalFail === 0) {
        tone = "ok";
      } else {
        tone = latestFailing === true ? "down" : "warn";
      }
    }

    return {
      key: `${instanceKey}:${assertionKey}`,
      assertionKey,
      label: labelForKey({ key: assertionKey }),
      latestText:
        passRate === null
          ? "—"
          : `${formatMetricValue({ value: Math.round(passRate * 10) / 10 })}% pass`,
      tone,
      sparkValues,
      stacked,
      totalPass,
      totalFail,
      configured:
        configuredKeys === undefined
          ? undefined
          : configuredKeys.includes(assertionKey),
    };
  });
}
