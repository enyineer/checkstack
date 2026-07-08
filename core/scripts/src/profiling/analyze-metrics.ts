/**
 * Checkstack metrics profiling analyzer.
 *
 * Turns one or two Prometheus `/metrics` snapshots (from the backend's
 * OpenTelemetry exporter - see `developer-guide/backend/observability`) into a
 * ranked, human-readable performance report. Designed to run against a snapshot
 * a user pastes into an issue: no live connection, just the scraped text.
 *
 *   bun run core/scripts/src/profiling/analyze-metrics.ts <snapshot.txt>
 *   bun run core/scripts/src/profiling/analyze-metrics.ts <t0.txt> <t1.txt>
 *
 * With ONE file it reports cumulative-since-boot totals. With TWO (a baseline
 * and a later scrape) it reports the DELTA over that window, which is the
 * accurate way to read "what is hot right now" - counters and histograms are
 * subtracted, gauges are read from the later snapshot. Pass `--interval <sec>`
 * to additionally express counts as per-second rates.
 *
 * Flags: `--top <n>` (rows per table, default 20), `--min-calls <n>` (floor for
 * the slowest-by-mean table, default 5), `--interval <seconds>`.
 *
 * It reads only Checkstack's own metric families and degrades gracefully: absent
 * families (e.g. `pg_stat_statements` not enabled, or a single snapshot) simply
 * omit their section rather than erroring.
 */
import { readFileSync } from "node:fs";
import { extractErrorMessage } from "@checkstack/common";
import {
  parseExposition,
  collectHistogram,
  diffHistogram,
  histogramQuantile,
  indexScalar,
  type Sample,
} from "./prometheus";

// ── Metric family names (as emitted by the Prometheus exporter) ──
const M = {
  queryDuration: "checkstack_db_query_duration",
  txDuration: "checkstack_db_transaction_duration",
  transactions: "checkstack_db_transactions_total",
  queries: "checkstack_db_queries_total",
  stmtCalls: "checkstack_db_statements_calls_total",
  stmtExecMs: "checkstack_db_statements_exec_time_ms_total",
  stmtRows: "checkstack_db_statements_rows_total",
  stmtMeanMs: "checkstack_db_statements_mean_exec_time_ms",
  pool: "checkstack_db_pool_connections",
  queueJobs: "checkstack_queue_jobs",
  eventLoop: "checkstack_runtime_event_loop_delay",
  hcExec: "checkstack_healthcheck_execution_duration",
} as const;

export interface Options {
  top: number;
  minCalls: number;
  intervalSeconds: number | null;
  files: string[];
}

export function parseArgs(argv: string[]): Options {
  const files: string[] = [];
  let top = 20;
  let minCalls = 5;
  let intervalSeconds: number | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--top": {
        top = Number(argv[++i]);
        break;
      }
      case "--min-calls": {
        minCalls = Number(argv[++i]);
        break;
      }
      case "--interval": {
        intervalSeconds = Number(argv[++i]);
        break;
      }
      default: {
        if (a.startsWith("--")) throw new Error(`Unknown flag: ${a}`);
        files.push(a);
      }
    }
  }
  if (files.length === 0 || files.length > 2) {
    throw new Error(
      "Usage: analyze-metrics <snapshot> [laterSnapshot] [--top n] [--min-calls n] [--interval sec]",
    );
  }
  if (!Number.isFinite(top) || top <= 0) top = 20;
  if (!Number.isFinite(minCalls) || minCalls < 0) minCalls = 5;
  return { top, minCalls, intervalSeconds, files };
}

// ── Report row models (pure builders, exported for testing) ──

export interface QueryRow {
  schema: string;
  operation: string;
  count: number;
  totalMs: number;
  meanMs: number;
  p95Ms: number;
}

/** DB query hot paths from the duration histogram (delta if `prev` given). */
export function buildQueryRows(
  samples: Sample[],
  prev: Sample[] | null,
): QueryRow[] {
  const later = collectHistogram(samples, M.queryDuration);
  const earlier = prev ? collectHistogram(prev, M.queryDuration) : null;
  const rows: QueryRow[] = [];
  for (const [key, s] of later) {
    const h = earlier ? diffHistogram(s, earlier.get(key)) : s;
    if (h.count <= 0) continue;
    rows.push({
      schema: h.labels.schema ?? "?",
      operation: h.labels.operation ?? "?",
      count: h.count,
      totalMs: h.sum,
      meanMs: h.sum / h.count,
      p95Ms: histogramQuantile(h, 0.95),
    });
  }
  return rows;
}

export interface TxRow {
  schema: string;
  batches: number;
  totalMs: number;
  meanMs: number;
  p95Ms: number;
}

/** `withScopedTransaction` connection-hold time from the tx-duration histogram. */
export function buildTxRows(samples: Sample[], prev: Sample[] | null): TxRow[] {
  const later = collectHistogram(samples, M.txDuration);
  const earlier = prev ? collectHistogram(prev, M.txDuration) : null;
  const rows: TxRow[] = [];
  for (const [key, s] of later) {
    const h = earlier ? diffHistogram(s, earlier.get(key)) : s;
    if (h.count <= 0) continue;
    rows.push({
      schema: h.labels.schema ?? "?",
      batches: h.count,
      totalMs: h.sum,
      meanMs: h.sum / h.count,
      p95Ms: histogramQuantile(h, 0.95),
    });
  }
  return rows;
}

export interface BatchingRow {
  schema: string;
  transactions: number;
  standaloneQueries: number;
  batchedTransactions: number;
}

/**
 * Batching effectiveness per schema. The scoped-db proxy counts one transaction
 * per standalone query AND per `withScopedTransaction` batch, but only counts a
 * `query` for STANDALONE queries (batched inner queries bypass the proxy seam).
 * So `transactions - queries = batched transactions`, and a schema with a high
 * `standaloneQueries` and near-zero `batchedTransactions` is paying one
 * round-trip per query - the prime batching candidate.
 */
export function buildBatchingRows(
  samples: Sample[],
  prev: Sample[] | null,
): BatchingRow[] {
  const tx = indexScalar(samples, M.transactions);
  const q = indexScalar(samples, M.queries);
  const txPrev = prev ? indexScalar(prev, M.transactions) : null;
  const qPrev = prev ? indexScalar(prev, M.queries) : null;
  const rows: BatchingRow[] = [];
  for (const [key, { labels, value }] of tx) {
    const transactions = value - (txPrev?.get(key)?.value ?? 0);
    const standaloneQueries =
      (q.get(key)?.value ?? 0) - (qPrev?.get(key)?.value ?? 0);
    if (transactions <= 0 && standaloneQueries <= 0) continue;
    rows.push({
      schema: labels.schema ?? "?",
      transactions,
      standaloneQueries,
      batchedTransactions: transactions - standaloneQueries,
    });
  }
  return rows;
}

export interface StatementRow {
  query: string;
  calls: number;
  totalExecMs: number;
  meanMs: number;
  rows: number;
}

/** Top `pg_stat_statements` statements (delta if `prev` given). Empty if absent. */
export function buildStatementRows(
  samples: Sample[],
  prev: Sample[] | null,
): StatementRow[] {
  const calls = indexScalar(samples, M.stmtCalls);
  const exec = indexScalar(samples, M.stmtExecMs);
  const rowsIdx = indexScalar(samples, M.stmtRows);
  const mean = indexScalar(samples, M.stmtMeanMs);
  const callsPrev = prev ? indexScalar(prev, M.stmtCalls) : null;
  const execPrev = prev ? indexScalar(prev, M.stmtExecMs) : null;
  const rowsPrev = prev ? indexScalar(prev, M.stmtRows) : null;
  const out: StatementRow[] = [];
  for (const [key, { labels }] of exec) {
    const totalExecMs =
      (exec.get(key)?.value ?? 0) - (execPrev?.get(key)?.value ?? 0);
    const c = (calls.get(key)?.value ?? 0) - (callsPrev?.get(key)?.value ?? 0);
    const r = (rowsIdx.get(key)?.value ?? 0) - (rowsPrev?.get(key)?.value ?? 0);
    if (totalExecMs <= 0 && c <= 0) continue;
    out.push({
      query: labels.query ?? labels.queryid ?? "?",
      calls: c,
      totalExecMs,
      // Prefer the true delta mean; fall back to the gauge for single-snapshot.
      meanMs: c > 0 ? totalExecMs / c : (mean.get(key)?.value ?? 0),
      rows: r,
    });
  }
  return out;
}

// ── Health signals (read from the LATER snapshot; these are gauges) ──

export interface HealthSignals {
  pool: Array<{ pool: string; state: string; value: number }>;
  queue: Array<{ state: string; value: number }>;
  eventLoopP95Ms: number | null;
  eventLoopMaxBucketMs: number | null;
  healthcheckRunsInWindow: number | null;
}

export function buildHealthSignals(
  samples: Sample[],
  prev: Sample[] | null,
): HealthSignals {
  const pool = samples
    .filter((s) => s.name === M.pool)
    .map((s) => ({
      pool: s.labels.pool ?? "?",
      state: s.labels.state ?? "?",
      value: s.value,
    }));
  const queue = samples
    .filter((s) => s.name === M.queueJobs)
    .map((s) => ({ state: s.labels.state ?? "?", value: s.value }));

  const elMap = collectHistogram(samples, M.eventLoop);
  let eventLoopP95Ms: number | null = null;
  let eventLoopMaxBucketMs: number | null = null;
  for (const s of elMap.values()) {
    eventLoopP95Ms = histogramQuantile(s, 0.95);
    // Highest finite bucket that actually caught samples = worst observed tick.
    const withCounts = s.buckets.filter((b) => Number.isFinite(b.le));
    for (let i = withCounts.length - 1; i >= 0; i--) {
      const below = i > 0 ? withCounts[i - 1].cumulative : 0;
      if (withCounts[i].cumulative - below > 0) {
        eventLoopMaxBucketMs = withCounts[i].le;
        break;
      }
    }
  }

  const hcLater = collectHistogram(samples, M.hcExec);
  const hcEarlier = prev ? collectHistogram(prev, M.hcExec) : null;
  let healthcheckRunsInWindow: number | null = null;
  if (hcLater.size > 0) {
    let total = 0;
    for (const [key, s] of hcLater) {
      total += prev ? diffHistogram(s, hcEarlier?.get(key)).count : s.count;
    }
    healthcheckRunsInWindow = total;
  }

  return {
    pool,
    queue,
    eventLoopP95Ms,
    eventLoopMaxBucketMs,
    healthcheckRunsInWindow,
  };
}

/** Auto-generated warnings/recommendations from the built rows + signals. */
export function buildFlags(input: {
  batching: BatchingRow[];
  queries: QueryRow[];
  statements: StatementRow[];
  signals: HealthSignals;
}): string[] {
  const flags: string[] = [];

  // High-volume schemas that are essentially unbatched.
  for (const b of input.batching) {
    if (
      b.standaloneQueries >= 100 &&
      b.batchedTransactions <= b.standaloneQueries * 0.05
    ) {
      flags.push(
        `Schema "${b.schema}" ran ${b.standaloneQueries} standalone queries with ~no batching - candidate for withScopedTransaction / set-based reads.`,
      );
    }
  }
  // Slow individual queries.
  for (const q of input.queries) {
    if (q.count >= 20 && q.p95Ms >= 50) {
      flags.push(
        `"${q.schema}|${q.operation}" p95 is ${q.p95Ms.toFixed(0)}ms over ${q.count} calls - a slow statement, drill down via pg_stat_statements.`,
      );
    }
  }
  // A single hot statement dominating exec time.
  const topStmt = input.statements.toSorted(
    (a, b) => b.totalExecMs - a.totalExecMs,
  )[0];
  if (topStmt && topStmt.meanMs >= 20) {
    flags.push(
      `Hottest statement averages ${topStmt.meanMs.toFixed(1)}ms/call over ${topStmt.calls} calls: ${clip(topStmt.query, 80)}`,
    );
  }
  // Pool saturation: callers blocked on connection checkout.
  const waiting = input.signals.pool.filter(
    (p) => p.state === "waiting" && p.value > 0,
  );
  for (const w of waiting) {
    flags.push(
      `DB pool "${w.pool}" has ${w.value} caller(s) WAITING on a connection - pool saturation.`,
    );
  }
  // Queue backlog.
  const pending = input.signals.queue.find((q) => q.state === "pending");
  if (pending && pending.value >= 100) {
    flags.push(
      `Queue backlog: ${pending.value} pending jobs - work is arriving faster than it drains.`,
    );
  }
  // Event-loop starvation.
  if (input.signals.eventLoopP95Ms !== null && input.signals.eventLoopP95Ms >= 50) {
    flags.push(
      `Event-loop delay p95 is ${input.signals.eventLoopP95Ms.toFixed(0)}ms - the JS thread is being blocked (CPU starvation), not just the DB.`,
    );
  }
  return flags;
}

// ── Formatting ──

function clip(s: string, n: number): string {
  const oneLine = s.replaceAll(/\s+/g, " ").trim();
  return oneLine.length > n ? `${oneLine.slice(0, n - 1)}…` : oneLine;
}

function fmt(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return "-";
  return n.toFixed(digits);
}

function table(headers: string[], rows: Array<Array<string | number>>): string {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => String(r[i] ?? "").length)),
  );
  const line = (cells: Array<string | number>) =>
    cells.map((c, i) => String(c ?? "").padEnd(widths[i])).join("  ");
  return [
    line(headers),
    line(widths.map((w) => "-".repeat(w))),
    ...rows.map((r) => line(r)),
  ].join("\n");
}

function rate(count: number, intervalSeconds: number | null): string {
  if (!intervalSeconds || intervalSeconds <= 0) return "";
  return `  (${(count / intervalSeconds).toFixed(2)}/s)`;
}

/** Build the full text report (pure; returns the string to print). */
export function buildReport(
  samples: Sample[],
  prev: Sample[] | null,
  opts: Options,
): string {
  const isDelta = prev !== null;
  const queries = buildQueryRows(samples, prev).toSorted(
    (a, b) => b.totalMs - a.totalMs,
  );
  const txRows = buildTxRows(samples, prev).toSorted(
    (a, b) => b.totalMs - a.totalMs,
  );
  const batching = buildBatchingRows(samples, prev).toSorted(
    (a, b) => b.standaloneQueries - a.standaloneQueries,
  );
  const statements = buildStatementRows(samples, prev).toSorted(
    (a, b) => b.totalExecMs - a.totalExecMs,
  );
  const signals = buildHealthSignals(samples, prev);
  const flags = buildFlags({ batching, queries, statements, signals });

  const out: string[] = [];
  const add = (...xs: string[]): void => {
    out.push(...xs);
  };

  add("=".repeat(78));
  add("Checkstack metrics analysis");
  add(
    isDelta
      ? "Mode: DELTA between two snapshots (the interval load; counters/histograms subtracted, gauges from the later snapshot)."
      : "Mode: CUMULATIVE since backend boot (single snapshot). For 'what is hot now', scrape twice and pass both files.",
  );
  if (signals.healthcheckRunsInWindow !== null) {
    add(
      `Workload marker: ${signals.healthcheckRunsInWindow} health-check run(s) in this ${isDelta ? "window" : "run"} (use to normalize other counts).`,
    );
  }
  add("=".repeat(78));

  // 1. Flags first - the headline.
  add("\n## Flags & recommendations");
  add(
    flags.length > 0
      ? flags.map((f) => `  ! ${f}`).join("\n")
      : "  (none - no threshold tripped)",
  );

  // 2. DB query hot paths by total time.
  add("\n## DB query hot paths (by total wall-clock)");
  add(
    table(
      ["schema|operation", "calls", "total ms", "mean ms", "p95 ms"],
      queries.slice(0, opts.top).map((r) => [
        `${r.schema}|${r.operation}`,
        `${r.count}${rate(r.count, opts.intervalSeconds)}`,
        fmt(r.totalMs),
        fmt(r.meanMs, 2),
        fmt(r.p95Ms, 2),
      ]),
    ),
  );

  // 3. Slowest by mean latency.
  const slow = queries
    .filter((r) => r.count >= opts.minCalls)
    .toSorted((a, b) => b.meanMs - a.meanMs)
    .slice(0, Math.min(opts.top, 15));
  add(`\n## Slowest by MEAN latency (min ${opts.minCalls} calls)`);
  add(
    table(
      ["schema|operation", "calls", "mean ms", "p95 ms"],
      slow.map((r) => [
        `${r.schema}|${r.operation}`,
        r.count,
        fmt(r.meanMs, 2),
        fmt(r.p95Ms, 2),
      ]),
    ),
  );

  // 4. Batching effectiveness.
  add("\n## Batching (standalone queries vs withScopedTransaction batches)");
  add(
    table(
      ["schema", "transactions", "standalone queries", "batched"],
      batching
        .slice(0, opts.top)
        .map((r) => [
          r.schema,
          r.transactions,
          r.standaloneQueries,
          r.batchedTransactions,
        ]),
    ),
  );

  // 5. Transaction hold time.
  if (txRows.length > 0) {
    add("\n## withScopedTransaction connection-hold time");
    add(
      table(
        ["schema", "batches", "total ms", "mean ms", "p95 ms"],
        txRows
          .slice(0, opts.top)
          .map((r) => [
            r.schema,
            r.batches,
            fmt(r.totalMs),
            fmt(r.meanMs, 2),
            fmt(r.p95Ms, 2),
          ]),
      ),
    );
  }

  // 6. pg_stat_statements drill-down (optional).
  add("\n## Top statements (pg_stat_statements)");
  add(
    statements.length > 0
      ? table(
          ["total ms", "calls", "mean ms", "rows", "statement"],
          statements
            .slice(0, opts.top)
            .map((r) => [
              fmt(r.totalExecMs),
              r.calls,
              fmt(r.meanMs, 2),
              r.rows,
              clip(r.query, 70),
            ]),
        )
      : "  (not present - enable pg_stat_statements for the per-statement drill-down; see docs)",
  );

  // 7. System health signals.
  add("\n## System signals");
  if (signals.pool.length > 0) {
    add("  DB pool:");
    for (const p of signals.pool) add(`    ${p.pool}/${p.state}: ${p.value}`);
  }
  if (signals.queue.length > 0) {
    add("  Queue jobs:");
    for (const q of signals.queue) add(`    ${q.state}: ${q.value}`);
  }
  if (signals.eventLoopP95Ms !== null) {
    add(
      `  Event-loop delay: p95 ${fmt(signals.eventLoopP95Ms)}ms, worst observed bucket <= ${signals.eventLoopMaxBucketMs ?? "?"}ms`,
    );
  }

  return out.join("\n") + "\n";
}

// ── CLI entry ──

function readSnapshot(file: string): Sample[] {
  return parseExposition(readFileSync(file, "utf8"));
}

/** Resolve the two-file case order-independently: the later snapshot has the
 * larger cumulative transactions total, so a user can paste them in any order. */
function orderSnapshots(
  a: Sample[],
  b: Sample[],
): { later: Sample[]; earlier: Sample[] } {
  const totalTx = (s: Sample[]): number =>
    [...indexScalar(s, M.transactions).values()].reduce(
      (n, v) => n + v.value,
      0,
    );
  return totalTx(b) >= totalTx(a)
    ? { later: b, earlier: a }
    : { later: a, earlier: b };
}

function run(argv: string[]): void {
  const opts = parseArgs(argv);
  let samples: Sample[];
  let prev: Sample[] | null;
  if (opts.files.length === 2) {
    const { later, earlier } = orderSnapshots(
      readSnapshot(opts.files[0]),
      readSnapshot(opts.files[1]),
    );
    samples = later;
    prev = earlier;
  } else {
    samples = readSnapshot(opts.files[0]);
    prev = null;
  }
  if (samples.length === 0) {
    throw new Error("No Prometheus samples parsed - is this a /metrics scrape?");
  }
  process.stdout.write(buildReport(samples, prev, opts));
}

// Only run when invoked directly (not when imported by the test).
if (import.meta.main) {
  try {
    run(process.argv.slice(2));
  } catch (error) {
    console.error(extractErrorMessage(error));
    process.exitCode = 1;
  }
}
