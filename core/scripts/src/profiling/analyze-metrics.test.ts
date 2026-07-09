import { describe, it, expect } from "bun:test";
import {
  parseExposition,
  parseLabels,
  collectHistogram,
  histogramQuantile,
  diffHistogram,
} from "./prometheus";
import {
  parseArgs,
  buildQueryRows,
  buildBatchingRows,
  buildStatementRows,
  buildHealthSignals,
  buildFlags,
  buildReport,
} from "./analyze-metrics";

const SCOPE = 'otel_scope_name="@checkstack/platform"';

/** A minimal but realistic exporter snapshot. */
function snapshot({
  anomalySelectCount,
  anomalySelectSum,
  anomalyTx,
  anomalyQueries,
  poolWaiting = 0,
  withStatements = false,
}: {
  anomalySelectCount: number;
  anomalySelectSum: number;
  anomalyTx: number;
  anomalyQueries: number;
  poolWaiting?: number;
  withStatements?: boolean;
}): string {
  const lines = [
    "# HELP checkstack_db_query_duration Standalone scoped-db query wall-clock.",
    "# TYPE checkstack_db_query_duration histogram",
    `checkstack_db_query_duration_count{schema="plugin_anomaly",operation="select",${SCOPE}} ${anomalySelectCount}`,
    `checkstack_db_query_duration_sum{schema="plugin_anomaly",operation="select",${SCOPE}} ${anomalySelectSum}`,
    `checkstack_db_query_duration_bucket{schema="plugin_anomaly",operation="select",${SCOPE},le="5"} ${Math.floor(anomalySelectCount * 0.8)}`,
    `checkstack_db_query_duration_bucket{schema="plugin_anomaly",operation="select",${SCOPE},le="25"} ${anomalySelectCount}`,
    `checkstack_db_query_duration_bucket{schema="plugin_anomaly",operation="select",${SCOPE},le="+Inf"} ${anomalySelectCount}`,
    "# TYPE checkstack_db_transactions_total counter",
    `checkstack_db_transactions_total{schema="plugin_anomaly",${SCOPE}} ${anomalyTx}`,
    "# TYPE checkstack_db_queries_total counter",
    `checkstack_db_queries_total{schema="plugin_anomaly",${SCOPE}} ${anomalyQueries}`,
    "# TYPE checkstack_db_pool_connections gauge",
    `checkstack_db_pool_connections{pool="admin",state="active",${SCOPE}} 3`,
    `checkstack_db_pool_connections{pool="admin",state="waiting",${SCOPE}} ${poolWaiting}`,
  ];
  if (withStatements) {
    lines.push(
      "# TYPE checkstack_db_statements_exec_time_ms_total counter",
      `checkstack_db_statements_exec_time_ms_total{queryid="123",query="select * from anomalies where system_id = $1",${SCOPE}} 500`,
      "# TYPE checkstack_db_statements_calls_total counter",
      `checkstack_db_statements_calls_total{queryid="123",query="select * from anomalies where system_id = $1",${SCOPE}} 100`,
      "# TYPE checkstack_db_statements_rows_total counter",
      `checkstack_db_statements_rows_total{queryid="123",query="select * from anomalies where system_id = $1",${SCOPE}} 100`,
    );
  }
  return lines.join("\n") + "\n";
}

describe("parseExposition / parseLabels", () => {
  it("parses counters, gauges, histogram lines and skips comments", () => {
    const samples = parseExposition(snapshot({
      anomalySelectCount: 10,
      anomalySelectSum: 25,
      anomalyTx: 10,
      anomalyQueries: 10,
    }));
    expect(samples.find((s) => s.name === "checkstack_db_transactions_total")?.value).toBe(10);
    expect(samples.some((s) => s.name.startsWith("#"))).toBe(false);
    const bucket = samples.find(
      (s) => s.name === "checkstack_db_query_duration_bucket" && s.labels.le === "+Inf",
    );
    expect(bucket?.value).toBe(10);
  });

  it("decodes escaped quotes, backslashes and newlines in labels", () => {
    const labels = parseLabels('a="he said \\"hi\\"",b="line1\\nline2",c="c:\\\\path"');
    expect(labels.a).toBe('he said "hi"');
    expect(labels.b).toBe("line1\nline2");
    expect(labels.c).toBe("c:\\path");
  });

  it("ignores a trailing timestamp and handles +Inf/NaN values", () => {
    const [s] = parseExposition('m{x="1"} 42 1700000000000\n');
    expect(s.value).toBe(42);
    expect(parseExposition("m +Inf\n")[0].value).toBe(Infinity);
    expect(Number.isNaN(parseExposition("m NaN\n")[0].value)).toBe(true);
  });
});

describe("histogramQuantile", () => {
  it("interpolates within the bucket and is bounded by the largest finite edge", () => {
    const samples = parseExposition(snapshot({
      anomalySelectCount: 100,
      anomalySelectSum: 300,
      anomalyTx: 100,
      anomalyQueries: 100,
    }));
    const [series] = [...collectHistogram(samples, "checkstack_db_query_duration").values()];
    const p95 = histogramQuantile(series, 0.95);
    // 80 samples <= 5ms, 100 <= 25ms → p95 (rank 95) falls in the (5,25] bucket.
    expect(p95).toBeGreaterThan(5);
    expect(p95).toBeLessThanOrEqual(25);
  });

  it("returns NaN for an empty histogram", () => {
    expect(histogramQuantile({ labels: {}, sum: 0, count: 0, buckets: [] }, 0.95)).toBeNaN();
  });
});

describe("diffHistogram", () => {
  it("subtracts sum/count/buckets", () => {
    const later = { labels: {}, sum: 30, count: 10, buckets: [{ le: 5, cumulative: 8 }, { le: Infinity, cumulative: 10 }] };
    const earlier = { labels: {}, sum: 12, count: 4, buckets: [{ le: 5, cumulative: 3 }, { le: Infinity, cumulative: 4 }] };
    const d = diffHistogram(later, earlier);
    expect(d.count).toBe(6);
    expect(d.sum).toBe(18);
    expect(d.buckets[0].cumulative).toBe(5);
  });
});

describe("buildQueryRows", () => {
  it("computes count/total/mean cumulatively for a single snapshot", () => {
    const rows = buildQueryRows(
      parseExposition(snapshot({ anomalySelectCount: 100, anomalySelectSum: 250, anomalyTx: 100, anomalyQueries: 100 })),
      null,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ schema: "plugin_anomaly", operation: "select", count: 100 });
    expect(rows[0].meanMs).toBeCloseTo(2.5, 5);
  });

  it("computes the DELTA window when a baseline is given", () => {
    const t0 = parseExposition(snapshot({ anomalySelectCount: 100, anomalySelectSum: 250, anomalyTx: 100, anomalyQueries: 100 }));
    const t1 = parseExposition(snapshot({ anomalySelectCount: 160, anomalySelectSum: 400, anomalyTx: 160, anomalyQueries: 160 }));
    const rows = buildQueryRows(t1, t0);
    expect(rows[0].count).toBe(60);
    expect(rows[0].totalMs).toBeCloseTo(150, 5);
  });
});

describe("buildBatchingRows", () => {
  it("derives batched = transactions - standalone queries", () => {
    // 200 tx, 50 standalone queries → 150 batched (i.e. withScopedTransaction).
    const rows = buildBatchingRows(
      parseExposition(snapshot({ anomalySelectCount: 50, anomalySelectSum: 100, anomalyTx: 200, anomalyQueries: 50 })),
      null,
    );
    expect(rows[0]).toMatchObject({ schema: "plugin_anomaly", transactions: 200, standaloneQueries: 50, batchedTransactions: 150 });
  });
});

describe("buildStatementRows", () => {
  it("is empty when pg_stat_statements is absent, populated when present", () => {
    expect(buildStatementRows(parseExposition(snapshot({ anomalySelectCount: 1, anomalySelectSum: 1, anomalyTx: 1, anomalyQueries: 1 })), null)).toHaveLength(0);
    const rows = buildStatementRows(
      parseExposition(snapshot({ anomalySelectCount: 1, anomalySelectSum: 1, anomalyTx: 1, anomalyQueries: 1, withStatements: true })),
      null,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].calls).toBe(100);
    expect(rows[0].meanMs).toBeCloseTo(5, 5); // 500ms / 100 calls
    expect(rows[0].query).toContain("anomalies");
  });
});

describe("buildFlags", () => {
  it("flags a high-volume unbatched schema and a waiting pool", () => {
    const samples = parseExposition(snapshot({
      anomalySelectCount: 300,
      anomalySelectSum: 600,
      anomalyTx: 300,
      anomalyQueries: 300, // all standalone → batched ≈ 0
      poolWaiting: 4,
    }));
    const batching = buildBatchingRows(samples, null);
    const queries = buildQueryRows(samples, null);
    const signals = buildHealthSignals(samples, null);
    const flags = buildFlags({ batching, queries, statements: [], signals });
    expect(flags.some((f) => f.includes("standalone queries with ~no batching"))).toBe(true);
    expect(flags.some((f) => f.includes("WAITING on a connection"))).toBe(true);
  });
});

describe("parseArgs", () => {
  it("parses files and flags", () => {
    const o = parseArgs(["a.txt", "b.txt", "--top", "5", "--interval", "300"]);
    expect(o.files).toEqual(["a.txt", "b.txt"]);
    expect(o.top).toBe(5);
    expect(o.intervalSeconds).toBe(300);
  });
  it("rejects zero or too many files, and unknown flags", () => {
    expect(() => parseArgs([])).toThrow();
    expect(() => parseArgs(["a", "b", "c"])).toThrow();
    expect(() => parseArgs(["a", "--nope"])).toThrow();
  });
});

describe("buildReport", () => {
  it("renders the expected sections and marks delta mode", () => {
    const t0 = parseExposition(snapshot({ anomalySelectCount: 100, anomalySelectSum: 250, anomalyTx: 100, anomalyQueries: 100 }));
    const t1 = parseExposition(snapshot({ anomalySelectCount: 160, anomalySelectSum: 400, anomalyTx: 160, anomalyQueries: 160, withStatements: true }));
    const report = buildReport(t1, t0, { top: 20, minCalls: 5, intervalSeconds: null, files: [] });
    expect(report).toContain("Mode: DELTA");
    expect(report).toContain("DB query hot paths");
    expect(report).toContain("Batching");
    expect(report).toContain("Top statements (pg_stat_statements)");
    expect(report).toContain("plugin_anomaly|select");
  });
});
