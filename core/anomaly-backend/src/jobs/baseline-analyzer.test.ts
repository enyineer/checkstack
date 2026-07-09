import { describe, test, expect, mock } from "bun:test";
import { setupBaselineAnalyzerJob } from "./baseline-analyzer";
import * as schema from "../schema";
import type { CollectorRegistry, RegisteredCollector } from "@checkstack/backend-api";
import {
  healthResultSchema,
  healthResultNumber,
} from "@checkstack/healthcheck-common";

// ─────────────────────────────────────────────────────────────────────────────
// Batching regression coverage for the hourly baseline analyzer.
//
// These tests drive the queue-consume handler directly and assert the QUERY
// SHAPE, proving the N+1s are gone:
//   1. The two per-assignment config reads are batched set-based under ONE
//      `withScopedTransaction` for ALL assignments (2 reads total, not 2 * N).
//   2. The per-field baseline upsert is collapsed into ONE multi-row insert per
//      environment.
//   3. The existing 'drift' rows are preloaded with ONE SELECT per environment
//      (not one per field inside evaluateDrift).
// ─────────────────────────────────────────────────────────────────────────────

function createMockLogger() {
  return {
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
  };
}

/**
 * Mock scoped db that records query shapes. All reads resolve empty (so the
 * service's batch config methods return defaults without parsing stored jsonb,
 * and the drift preload returns an empty map). `transaction` invokes the
 * callback with a runner that records its selects too, so we can assert the
 * config reads ran inside the batching transaction.
 */
function createAnalyzerDb() {
  const selects: Array<{ table: unknown }> = [];
  const baselineInsertValues: unknown[][] = [];
  const anomalyInsertCount = { n: 0 };
  const transaction = { count: 0 };

  const selectApi = () => ({
    from: (table: unknown) => ({
      where: (_cond: unknown) => {
        selects.push({ table });
        return Promise.resolve([]);
      },
    }),
  });

  const runner = { select: selectApi };

  const db = {
    select: selectApi,
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      transaction.count++;
      return fn(runner);
    },
    insert: (table: unknown) => ({
      values: (vals: unknown) => {
        if (table === schema.anomalyBaselines) {
          baselineInsertValues.push(vals as unknown[]);
        } else if (table === schema.anomalies) {
          anomalyInsertCount.n++;
        }
        return {
          onConflictDoUpdate: () => Promise.resolve(),
          returning: () => Promise.resolve([{ id: "new-id" }]),
        };
      },
    }),
    update: () => ({
      set: () => ({ where: () => Promise.resolve() }),
    }),
    delete: () => ({ where: () => Promise.resolve() }),
    _selects: selects,
    _baselineInsertValues: baselineInsertValues,
    _anomalyInsertCount: anomalyInsertCount,
    _transaction: transaction,
  };
  return db;
}

const resultSchema = healthResultSchema({
  responseTimeMs: healthResultNumber({
    "x-chart-type": "line",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "lower-is-better",
  }),
});

function createMockCollectorRegistry(): CollectorRegistry {
  const registered = {
    qualifiedId: "http.request",
    collector: { result: { schema: resultSchema } },
    ownerPlugin: { id: "healthcheck-http", name: "HTTP" },
  } as unknown as RegisteredCollector;
  return {
    register: mock(() => {}),
    getCollector: mock(() => registered),
    getCollectorsForPlugin: mock(() => [registered]),
    getCollectors: mock(() => [registered]),
  };
}

/** Build N env-less runs carrying one numeric collector field. */
function buildRuns(count: number) {
  return Array.from({ length: count }, (_v, i) => ({
    environmentId: null as string | null,
    result: {
      metadata: {
        collectors: {
          "uuid-1": {
            _collectorId: "http.request",
            // Increasing values so a slope exists; exact drift outcome is
            // irrelevant to these batching assertions.
            responseTimeMs: 100 + i,
          },
        },
      },
    },
  }));
}

async function runAnalyzer({
  activeAssignments,
}: {
  activeAssignments: unknown[];
}) {
  const db = createAnalyzerDb();
  let captured: ((job: unknown) => Promise<void>) | undefined;
  const queue = {
    consume: mock(async (fn: (job: unknown) => Promise<void>) => {
      captured = fn;
    }),
    scheduleRecurring: mock(async () => {}),
  };
  const queueManager = { getQueue: mock(() => queue) };
  const healthCheckClient = {
    getRunsForAnalysis: mock(async () => activeAssignments),
  };
  const cache = { set: mock(async () => {}) };

  await setupBaselineAnalyzerJob({
    db: db as never,
    cache: cache as never,
    logger: createMockLogger() as never,
    queueManager: queueManager as never,
    healthCheckClient: healthCheckClient as never,
    catalogClient: {} as never,
    notificationClient: {} as never,
    collectorRegistry: createMockCollectorRegistry(),
  });

  expect(captured).toBeDefined();
  await captured?.({});

  return { db, healthCheckClient };
}

describe("setupBaselineAnalyzerJob — query-shape batching", () => {
  test("batches config reads and per-field baseline upserts, preloads drift rows once per env", async () => {
    // Two assignments, each one env-less field with 24 samples.
    const activeAssignments = [
      {
        systemId: "sys-a",
        configurationId: "11111111-1111-1111-1111-111111111111",
        runs: buildRuns(24),
      },
      {
        systemId: "sys-b",
        configurationId: "22222222-2222-2222-2222-222222222222",
        runs: buildRuns(24),
      },
    ];

    const { db, healthCheckClient } = await runAnalyzer({ activeAssignments });

    // The RPC ran once, up front (outside any transaction).
    expect(healthCheckClient.getRunsForAnalysis).toHaveBeenCalledTimes(1);

    // Config preload: exactly ONE transaction, holding exactly TWO reads
    // (configs + assignments) for BOTH assignments — not 2 per assignment.
    expect(db._transaction.count).toBe(1);
    const configReads = db._selects.filter(
      (s) => s.table === schema.anomalyConfigurations,
    );
    const assignmentReads = db._selects.filter(
      (s) => s.table === schema.anomalyAssignments,
    );
    expect(configReads.length).toBe(1);
    expect(assignmentReads.length).toBe(1);

    // Baseline upsert: ONE multi-row insert per env (2 envs → 2 inserts), each
    // an array of rows, NOT one insert per field.
    expect(db._baselineInsertValues.length).toBe(2);
    for (const vals of db._baselineInsertValues) {
      expect(Array.isArray(vals)).toBe(true);
      expect(vals.length).toBe(1);
    }

    // Drift preload: ONE SELECT against `anomalies` per env (2 total).
    const anomalyReads = db._selects.filter(
      (s) => s.table === schema.anomalies,
    );
    expect(anomalyReads.length).toBe(2);
  });

  test("skips an env with no field reaching the sample threshold (no upsert)", async () => {
    const activeAssignments = [
      {
        systemId: "sys-a",
        configurationId: "11111111-1111-1111-1111-111111111111",
        runs: buildRuns(10), // below MIN_BASELINE_SAMPLES (24)
      },
    ];

    const { db } = await runAnalyzer({ activeAssignments });

    // Nothing qualifies → no baseline upsert and no drift preload for the env.
    expect(db._baselineInsertValues.length).toBe(0);
    const anomalyReads = db._selects.filter(
      (s) => s.table === schema.anomalies,
    );
    expect(anomalyReads.length).toBe(0);
    // The config preload transaction still runs once.
    expect(db._transaction.count).toBe(1);
  });
});
