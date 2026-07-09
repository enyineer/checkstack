import {
  metrics,
  type Counter,
  type Histogram,
  type Meter,
} from "@opentelemetry/api";

/**
 * Platform metric instruments (OpenTelemetry).
 *
 * These are created against the global OTel `MeterProvider`. Until the host
 * registers a real provider (see the SDK bootstrap in `core/backend`), the API
 * hands back NO-OP instruments, so recording a metric is free and the whole
 * layer is inert when metrics are disabled. The host enables it with
 * `CHECKSTACK_METRICS_ENABLED=1`, which registers a provider + Prometheus
 * exporter BEFORE any query runs, so the lazy instruments below bind to the
 * real meter on first use.
 *
 * Instruments are defined ONCE here (foundation layer) and recorded at call
 * sites across the platform; the host owns the SDK, exporter, and the
 * observable gauges that read host-owned state (DB pools, event-loop delay).
 */

const METER_NAME = "@checkstack/platform";

let meter: Meter | undefined;
function getMeter(): Meter {
  meter ??= metrics.getMeter(METER_NAME);
  return meter;
}

let dbTransactions: Counter | undefined;
/**
 * Scoped-db transactions opened. The scoped-db proxy wraps every standalone
 * query in its own transaction (BEGIN + SET LOCAL + COMMIT); a
 * `withScopedTransaction` batch opens exactly one. So `db.transactions` /
 * `db.queries` reveals how much per-query transaction overhead a workload pays,
 * and how effective batching is. Attribute: `schema` (the plugin schema).
 */
export function dbTransactionsCounter(): Counter {
  dbTransactions ??= getMeter().createCounter("checkstack.db.transactions", {
    description:
      "Scoped-db transactions opened (one per standalone query, or one per withScopedTransaction batch).",
    unit: "{transaction}",
  });
  return dbTransactions;
}

let dbQueries: Counter | undefined;
/** Scoped-db query-builder executions. Attribute: `schema`. */
export function dbQueriesCounter(): Counter {
  dbQueries ??= getMeter().createCounter("checkstack.db.queries", {
    description: "Scoped-db query-builder executions (select/insert/update/delete/execute/$count).",
    unit: "{query}",
  });
  return dbQueries;
}

let dbQueryDuration: Histogram | undefined;
/**
 * Wall-clock of a STANDALONE scoped query (its own BEGIN + SET LOCAL + query +
 * COMMIT), measured at the scoped-db proxy seam. Attributes: `schema` (plugin
 * schema) and `operation` (select/insert/update/delete/execute/$count) — both
 * BOUNDED so Prometheus cardinality stays flat. This is the RED-style "how long
 * do queries take, how often" signal; pair it with `pg_stat_statements` for the
 * per-statement drill-down. NEVER attribute raw SQL / parameter values / ids
 * here — that would be unbounded cardinality.
 */
export function dbQueryDurationHistogram(): Histogram {
  dbQueryDuration ??= getMeter().createHistogram("checkstack.db.query.duration", {
    description:
      "Standalone scoped-db query wall-clock (BEGIN+SET LOCAL+query+COMMIT). Attributes: schema, operation.",
    unit: "ms",
  });
  return dbQueryDuration;
}

let dbTransactionDuration: Histogram | undefined;
/**
 * Wall-clock a `withScopedTransaction` batch holds its connection (BEGIN → SET
 * LOCAL → N queries → COMMIT). Attribute: `schema`. Rising values mean a batch
 * is pinning a pooled connection for long — the thing to watch after the
 * scoped-tx batching optimizations, and a guard against accidentally wrapping
 * slow (non-db) work inside a transaction.
 */
export function dbTransactionDurationHistogram(): Histogram {
  dbTransactionDuration ??= getMeter().createHistogram(
    "checkstack.db.transaction.duration",
    {
      description:
        "withScopedTransaction batch wall-clock (connection hold time). Attribute: schema.",
      unit: "ms",
    },
  );
  return dbTransactionDuration;
}

let healthcheckExecution: Histogram | undefined;
/** Health-check job wall-clock. Attribute: `status`. */
export function healthcheckExecutionHistogram(): Histogram {
  healthcheckExecution ??= getMeter().createHistogram(
    "checkstack.healthcheck.execution.duration",
    {
      description: "Health-check job execution wall-clock time.",
      unit: "ms",
    },
  );
  return healthcheckExecution;
}

let healthcheckPhase: Histogram | undefined;
/**
 * Per-run network sub-phase durations for a health-check probe. Attribute:
 * `phase` (dns/connect/tls/wait/transfer). This is what distinguishes a slow
 * TARGET (`wait` grows) from slow CONNECTION ESTABLISHMENT (`connect`/`tls`
 * grow, e.g. a same-host connection stampede) from platform delay.
 */
export function healthcheckPhaseHistogram(): Histogram {
  healthcheckPhase ??= getMeter().createHistogram(
    "checkstack.healthcheck.phase.duration",
    {
      description:
        "Health-check probe network sub-phase duration (dns/connect/tls/wait/transfer).",
      unit: "ms",
    },
  );
  return healthcheckPhase;
}

let healthcheckDeferred: Counter | undefined;
/**
 * Suspect (slot-hogging) health-check env-runs deferred by the slow-check
 * bulkhead instead of executed this tick. Attribute: `reason` -
 * `lane_full` (the pod's suspect lane was at capacity) or `in_flight` (a prior
 * run of the same (config, system, env) was still executing). A climbing
 * `lane_full` under a correlated outage is the bulkhead protecting healthy
 * checks from slot starvation; it is expected, not an error.
 */
export function healthcheckDeferredCounter(): Counter {
  healthcheckDeferred ??= getMeter().createCounter(
    "checkstack.healthcheck.deferred",
    {
      description:
        "Suspect health-check env-runs deferred by the slow-check bulkhead (reason=lane_full|in_flight).",
      unit: "{run}",
    },
  );
  return healthcheckDeferred;
}

let queueEnqueued: Counter | undefined;
/** Jobs enqueued. Attribute: `queue`. */
export function queueEnqueuedCounter(): Counter {
  queueEnqueued ??= getMeter().createCounter("checkstack.queue.enqueued", {
    description: "Jobs enqueued into an in-memory queue.",
    unit: "{job}",
  });
  return queueEnqueued;
}

let queueProcessed: Counter | undefined;
/** Jobs processed. Attributes: `queue`, `status` (completed/failed). */
export function queueProcessedCounter(): Counter {
  queueProcessed ??= getMeter().createCounter("checkstack.queue.processed", {
    description: "Jobs processed by an in-memory queue consumer.",
    unit: "{job}",
  });
  return queueProcessed;
}
