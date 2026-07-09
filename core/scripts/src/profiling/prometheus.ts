/**
 * Minimal Prometheus text-exposition parser + histogram helpers, used by the
 * metrics profiling analyzer (`analyze-metrics.ts`).
 *
 * It intentionally covers only what the Checkstack `/metrics` endpoint emits
 * (counters, gauges, and OpenTelemetry-style histograms with `_sum`/`_count`/
 * `_bucket{le=...}`), not the whole spec - no exemplars, no `{quantile=...}`
 * summaries. The goal is to turn a scraped snapshot (or two) into structured
 * samples so the analyzer can rank hot paths without pulling in a full client
 * library.
 */

/** A single parsed time series line: `name{labels} value`. */
export interface Sample {
  name: string;
  labels: Record<string, string>;
  value: number;
}

/**
 * Parse a Prometheus text-exposition payload into samples. `# HELP`/`# TYPE`
 * comment lines and blanks are skipped; unparseable lines are ignored (a pasted
 * snapshot from an issue may be truncated). Values of `NaN`/`+Inf`/`-Inf` are
 * kept as JS `NaN`/`Infinity`.
 */
export function parseExposition(text: string): Sample[] {
  const out: Sample[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const parsed = parseLine(line);
    if (parsed) out.push(parsed);
  }
  return out;
}

function parseLine(line: string): Sample | null {
  // name{labels} value   OR   name value
  const braceStart = line.indexOf("{");
  let name: string;
  let labels: Record<string, string> = {};
  let rest: string;
  if (braceStart === -1) {
    const sp = line.indexOf(" ");
    if (sp === -1) return null;
    name = line.slice(0, sp);
    rest = line.slice(sp + 1).trim();
  } else {
    const braceEnd = line.lastIndexOf("}");
    if (braceEnd <= braceStart) return null;
    name = line.slice(0, braceStart);
    labels = parseLabels(line.slice(braceStart + 1, braceEnd));
    rest = line.slice(braceEnd + 1).trim();
  }
  // The value is the first whitespace-delimited token (a trailing timestamp,
  // if present, is ignored).
  const valueToken = rest.split(/\s+/)[0];
  const value = parseValue(valueToken);
  if (value === undefined) return null;
  return { name, labels, value };
}

function parseValue(token: string | undefined): number | undefined {
  if (token === undefined) return undefined;
  if (token === "+Inf") return Infinity;
  if (token === "-Inf") return -Infinity;
  if (token === "NaN") return Number.NaN;
  const n = Number(token);
  return Number.isNaN(n) ? undefined : n;
}

/**
 * Parse a label block (`a="1",b="2"`). Handles escaped quotes/backslashes/
 * newlines per the exposition format. Deliberately tolerant: a malformed pair
 * is skipped rather than failing the whole line.
 */
export function parseLabels(block: string): Record<string, string> {
  const labels: Record<string, string> = {};
  let i = 0;
  const n = block.length;
  while (i < n) {
    while (i < n && (block[i] === "," || block[i] === " ")) i++;
    const eq = block.indexOf("=", i);
    if (eq === -1) break;
    const key = block.slice(i, eq).trim();
    let j = eq + 1;
    if (block[j] !== '"') break;
    j++;
    let value = "";
    while (j < n && block[j] !== '"') {
      if (block[j] === "\\" && j + 1 < n) {
        const next = block[j + 1];
        value += next === "n" ? "\n" : next; // \\ and \" fall through to the char
        j += 2;
      } else {
        value += block[j];
        j++;
      }
    }
    if (key.length > 0) labels[key] = value;
    i = j + 1; // skip closing quote
  }
  return labels;
}

/** A histogram series for one label set: totals plus cumulative buckets. */
export interface HistogramSeries {
  labels: Record<string, string>;
  sum: number;
  count: number;
  /** Cumulative `le` buckets, ascending; the `+Inf` bucket has `le: Infinity`. */
  buckets: Array<{ le: number; cumulative: number }>;
}

/** Stable key for a label set, ignoring noise labels the analyzer never groups on. */
export function labelKey(
  labels: Record<string, string>,
  ignore: readonly string[] = ["otel_scope_name", "otel_scope_version", "le"],
): string {
  return Object.keys(labels)
    .filter((k) => !ignore.includes(k))
    .toSorted()
    .map((k) => `${k}=${labels[k]}`)
    .join(",");
}

/**
 * Collect a histogram family (base name without suffix) from samples into one
 * {@link HistogramSeries} per label set, reading `<base>_sum`, `<base>_count`,
 * and `<base>_bucket{le}`.
 */
export function collectHistogram(
  samples: Sample[],
  base: string,
): Map<string, HistogramSeries> {
  const byKey = new Map<string, HistogramSeries>();
  const ensure = (labels: Record<string, string>): HistogramSeries => {
    const key = labelKey(labels);
    let s = byKey.get(key);
    if (!s) {
      const { le: _le, ...rest } = labels;
      void _le;
      s = { labels: rest, sum: 0, count: 0, buckets: [] };
      byKey.set(key, s);
    }
    return s;
  };
  for (const sample of samples) {
    if (sample.name === `${base}_sum`) {
      ensure(sample.labels).sum = sample.value;
      continue;
    }
    if (sample.name === `${base}_count`) {
      ensure(sample.labels).count = sample.value;
      continue;
    }
    if (sample.name === `${base}_bucket`) {
      const leRaw = sample.labels.le;
      if (leRaw === undefined) continue;
      const le = leRaw === "+Inf" ? Infinity : Number(leRaw);
      if (Number.isNaN(le)) continue;
      ensure(sample.labels).buckets.push({ le, cumulative: sample.value });
    }
  }
  for (const s of byKey.values()) {
    s.buckets = s.buckets.toSorted((a, b) => a.le - b.le);
  }
  return byKey;
}

/**
 * Estimate a quantile (0..1) from cumulative histogram buckets using Prometheus'
 * linear-interpolation-within-bucket method. Returns `NaN` for an empty
 * histogram. The result is bounded by the largest FINITE bucket edge (the
 * `+Inf` bucket has no upper bound to interpolate toward).
 */
export function histogramQuantile(series: HistogramSeries, q: number): number {
  const total = series.count;
  if (total <= 0 || series.buckets.length === 0) return Number.NaN;
  const rank = q * total;
  let prevCum = 0;
  let prevLe = 0;
  for (const b of series.buckets) {
    if (b.cumulative >= rank) {
      if (!Number.isFinite(b.le)) return prevLe; // in the +Inf bucket
      const inBucket = b.cumulative - prevCum;
      if (inBucket <= 0) return b.le;
      const frac = (rank - prevCum) / inBucket;
      return prevLe + frac * (b.le - prevLe);
    }
    prevCum = b.cumulative;
    prevLe = Number.isFinite(b.le) ? b.le : prevLe;
  }
  return prevLe;
}

/** Subtract a baseline histogram from a later one (delta over a window). */
export function diffHistogram(
  later: HistogramSeries,
  earlier: HistogramSeries | undefined,
): HistogramSeries {
  if (!earlier) return later;
  const earlierBuckets = new Map(earlier.buckets.map((b) => [b.le, b.cumulative]));
  return {
    labels: later.labels,
    sum: later.sum - earlier.sum,
    count: later.count - earlier.count,
    buckets: later.buckets.map((b) => ({
      le: b.le,
      cumulative: b.cumulative - (earlierBuckets.get(b.le) ?? 0),
    })),
  };
}

/** Index plain counter/gauge samples of one metric name by label key -> value. */
export function indexScalar(
  samples: Sample[],
  name: string,
): Map<string, { labels: Record<string, string>; value: number }> {
  const map = new Map<string, { labels: Record<string, string>; value: number }>();
  for (const s of samples) {
    if (s.name !== name) continue;
    map.set(labelKey(s.labels), { labels: s.labels, value: s.value });
  }
  return map;
}
