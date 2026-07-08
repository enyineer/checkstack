import { metrics, type Meter } from "@opentelemetry/api";
import { rootLogger } from "./logger";

/**
 * The only DB capability this module needs: run a parameterized query and read
 * `rows` + `rowCount`. Typing to this minimal shape (rather than the full `pg`
 * `Pool`) keeps the profiler decoupled and lets tests pass a lightweight fake
 * without a real connection. A real `pg.Pool` satisfies it structurally.
 */
export interface StatementsQueryable {
  query<R>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: R[]; rowCount: number | null }>;
}

/** Raw `pg_stat_statements` row shape (numeric columns arrive as strings). */
interface RawStatementRow {
  queryid: string | null;
  query: string | null;
  calls: string | number;
  total_exec_time: string | number;
  mean_exec_time: string | number;
  rows: string | number;
}

/**
 * Query profiler: export per-statement hot-path stats from `pg_stat_statements`.
 *
 * The scoped-db duration histograms (`checkstack.db.query.duration`) tell you
 * how long queries take AT THE APPLICATION SEAM, bucketed by schema+operation.
 * This exporter is the per-statement DRILL-DOWN: it reads Postgres' own
 * `pg_stat_statements` view (normalized statement text, call count, total/mean
 * execution time, rows) so you can see WHICH statements are hot, not just which
 * operation kind.
 *
 * ## No-op fallback
 *
 * `pg_stat_statements` is an optional contrib extension that must be loaded via
 * `shared_preload_libraries` AND created (`CREATE EXTENSION pg_stat_statements`).
 * If it is not active in the connected database - or the connecting role cannot
 * read the view - this exporter registers NOTHING and logs once. The rest of the
 * metrics layer is unaffected. So a deployment without the extension pays zero
 * cost and sees no error, exactly as if the profiler were disabled.
 *
 * ## Cardinality
 *
 * Per-statement labels are inherently higher cardinality than the bounded
 * schema/operation histograms, so this exporter is deliberately bounded to the
 * TOP-N statements by total execution time (`CHECKSTACK_DB_STATEMENTS_TOP_N`,
 * default 25). The `queryid` label is a stable statement fingerprint; the
 * `query` label is the normalized statement text truncated for readability.
 * Because the top-N SET shifts over time, Prometheus will accumulate some stale
 * series until they age out - this is inherent to top-N profiling and is why the
 * whole exporter (like all metrics here) is opt-in via `CHECKSTACK_METRICS_ENABLED`.
 */

const METER_NAME = "@checkstack/platform";
const DEFAULT_TOP_N = 25;
/** Truncate the normalized statement text so a huge query can't bloat a label. */
const QUERY_LABEL_MAX_CHARS = 200;

/** A single hot-statement row projected from `pg_stat_statements`. */
export interface StatementStat {
  queryid: string;
  query: string;
  calls: number;
  totalExecTimeMs: number;
  meanExecTimeMs: number;
  rows: number;
}

function topNFromEnv(): number {
  const raw = process.env.CHECKSTACK_DB_STATEMENTS_TOP_N;
  if (raw === undefined || raw === "") return DEFAULT_TOP_N;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TOP_N;
}

/** Collapse whitespace and clip the statement text used as a metric label. */
export function toQueryLabel(query: string): string {
  const collapsed = query.replaceAll(/\s+/g, " ").trim();
  return collapsed.length > QUERY_LABEL_MAX_CHARS
    ? `${collapsed.slice(0, QUERY_LABEL_MAX_CHARS)}…`
    : collapsed;
}

/**
 * Project a raw `pg_stat_statements` row into a typed {@link StatementStat}:
 * coalesce a null `queryid` to `"unknown"`, coerce the string-typed numeric
 * columns, and normalize the statement text for use as a bounded label.
 */
export function projectStatementRow(raw: RawStatementRow): StatementStat {
  return {
    queryid: raw.queryid === null ? "unknown" : String(raw.queryid),
    query: toQueryLabel(raw.query ?? ""),
    calls: Number(raw.calls),
    totalExecTimeMs: Number(raw.total_exec_time),
    meanExecTimeMs: Number(raw.mean_exec_time),
    rows: Number(raw.rows),
  };
}

/**
 * Is `pg_stat_statements` usable on this connection? True only when the
 * extension is installed AND the role can actually read its view. A failure
 * here (extension absent, or `permission denied`) means "no-op", never a throw.
 */
export async function isPgStatStatementsAvailable({
  pool,
}: {
  pool: StatementsQueryable;
}): Promise<boolean> {
  try {
    const ext = await pool.query(
      "SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements'",
    );
    if (ext.rowCount === 0) return false;
    // Extension present - confirm the view is actually readable by this role
    // (it requires superuser or pg_read_all_stats). A LIMIT 0 probe touches the
    // view without materializing rows.
    await pool.query("SELECT 1 FROM pg_stat_statements LIMIT 0");
    return true;
  } catch {
    return false;
  }
}

/**
 * Read the top-N hottest statements (by total execution time) for the CURRENT
 * database. Uses the PG13+ column names (`total_exec_time` / `mean_exec_time`).
 */
export async function fetchTopStatements({
  pool,
  topN,
}: {
  pool: StatementsQueryable;
  topN: number;
}): Promise<StatementStat[]> {
  const { rows } = await pool.query<RawStatementRow>(
    `SELECT queryid, query, calls, total_exec_time, mean_exec_time, rows
       FROM pg_stat_statements
      WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
      ORDER BY total_exec_time DESC
      LIMIT $1`,
    [topN],
  );
  return rows.map((row) => projectStatementRow(row));
}

/**
 * Register the `pg_stat_statements` observable instruments against the global
 * meter. Async because it probes extension availability first: if the extension
 * is not active (or unreadable), it registers nothing and logs once - a clean
 * no-op. Safe to call fire-and-forget after `startMetrics()`; only meaningful
 * when metrics are enabled (a global MeterProvider is registered).
 *
 * All instruments are read on scrape via a SINGLE batch callback, so one query
 * per scrape feeds every series.
 */
export async function registerDbStatementInstruments({
  pool,
}: {
  pool: StatementsQueryable;
}): Promise<void> {
  const available = await isPgStatStatementsAvailable({ pool });
  if (!available) {
    rootLogger.info(
      "Metrics: pg_stat_statements not active (extension missing or unreadable); query profiler disabled (no-op).",
    );
    return;
  }

  const topN = topNFromEnv();
  const meter: Meter = metrics.getMeter(METER_NAME);

  // Cumulative counters (monotonic between resets; Prometheus handles resets).
  const calls = meter.createObservableCounter("checkstack.db.statements.calls", {
    description: "pg_stat_statements: cumulative call count for a hot statement.",
    unit: "{call}",
  });
  const execTime = meter.createObservableCounter(
    "checkstack.db.statements.exec_time_ms",
    {
      description:
        "pg_stat_statements: cumulative total execution time for a hot statement.",
      unit: "ms",
    },
  );
  const rowsCounter = meter.createObservableCounter(
    "checkstack.db.statements.rows",
    {
      description:
        "pg_stat_statements: cumulative rows returned/affected by a hot statement.",
      unit: "{row}",
    },
  );
  // Point-in-time average per call (not monotonic → gauge).
  const meanTime = meter.createObservableGauge(
    "checkstack.db.statements.mean_exec_time_ms",
    {
      description:
        "pg_stat_statements: mean execution time per call for a hot statement.",
      unit: "ms",
    },
  );

  meter.addBatchObservableCallback(
    async (result) => {
      let stats: StatementStat[];
      try {
        stats = await fetchTopStatements({ pool, topN });
      } catch {
        // Best-effort: a transient error (or a mid-run reset) just skips this
        // scrape rather than crashing the exporter.
        return;
      }
      for (const s of stats) {
        const attrs = { queryid: s.queryid, query: s.query };
        result.observe(calls, s.calls, attrs);
        result.observe(execTime, s.totalExecTimeMs, attrs);
        result.observe(rowsCounter, s.rows, attrs);
        result.observe(meanTime, s.meanExecTimeMs, attrs);
      }
    },
    [calls, execTime, rowsCounter, meanTime],
  );

  rootLogger.info(
    `Metrics: pg_stat_statements query profiler enabled (top ${topN} statements by total exec time).`,
  );
}
