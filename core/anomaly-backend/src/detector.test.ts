import { describe, test, expect, mock, type Mock } from "bun:test";
import { processCheckCompleted } from "./detector";
import * as schema from "./schema";
import type { FieldBaseline, AnomalySettings } from "@checkstack/anomaly-common";
import type { CacheProvider } from "@checkstack/cache-api";
import type { CollectorRegistry, RegisteredCollector } from "@checkstack/backend-api";
import {
  healthResultSchema,
  healthResultNumber,
  healthResultString,
  healthResultBoolean,
} from "@checkstack/healthcheck-common";

// ─────────────────────────────────────────────────────────────────────────────
// Mock Factories
// ─────────────────────────────────────────────────────────────────────────────

function createBaseline(overrides: Partial<FieldBaseline> = {}): FieldBaseline {
  return {
    mean: 100,
    stdDev: 10,
    trendSlope: 0,
    sampleCount: 50,
    computedAt: "2026-04-28T00:00:00.000Z",
    ...overrides,
  };
}

function createMockCache(baselineMap: Map<string, FieldBaseline> = new Map()): CacheProvider {
  return {
    get: mock(async (key: string) => baselineMap.get(key)) as CacheProvider["get"],
    set: mock(async () => {}),
    delete: mock(async () => {}),
    deleteByPrefix: mock(async () => 0),
    has: mock(async () => false),
  };
}

function createMockCatalogClient() {
  return {
    getSystem: mock(async () => ({ name: "Test System" })),
    notifySystemSubscribers: mock(async () => ({ notifiedCount: 0 })),
  };
}

function createMockNotificationClient(subscriberIds: string[] = ["user-1"]) {
  return {
    notifyForSubscription: mock(async () => ({
      notifiedCount: subscriberIds.length,
    })),
  };
}

function createMockLogger() {
  return {
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
  };
}

/**
 * Creates a mock DB using reference equality against imported schema tables
 * to correctly route queries to the right return values.
 */
function createMockDb({
  existingAnomaly,
  baselineFromDb,
  configRecord,
  assignmentRecord,
}: {
  existingAnomaly?: Record<string, unknown>;
  baselineFromDb?: Record<string, unknown>;
  configRecord?: Record<string, unknown>;
  assignmentRecord?: Record<string, unknown>;
} = {}) {
  const insertCalls: Array<Record<string, unknown>> = [];
  const updateCalls: Array<Record<string, unknown>> = [];
  const deleteCalls: unknown[] = [];
  // Captures the WHERE condition passed to each SELECT against the `anomalies`
  // table so tests can assert the per-env lookup predicate (env id vs IS NULL).
  const anomalyWheres: unknown[] = [];

  /**
   * Create an object that is BOTH awaitable (thenable) and has .limit() / .orderBy().
   * Drizzle queries can be consumed in two ways:
   *   1. `const [result] = await db.select().from(t).where(c)` (service pattern)
   *   2. `const [result] = await db.select().from(t).where(c).limit(1)` (detector pattern)
   */
  const makeThenableChain = (rows: unknown[]) => {
    const promise = Promise.resolve(rows);
    return {
      then: promise.then.bind(promise),
      catch: promise.catch.bind(promise),
      limit: mock(() => Promise.resolve(rows)),
      orderBy: mock(() => ({
        then: promise.then.bind(promise),
        catch: promise.catch.bind(promise),
        limit: mock(() => Promise.resolve(rows)),
      })),
    };
  };

  const makeWhereChain = (
    rows: unknown[],
    onWhere?: (condition: unknown) => void,
  ) => ({
    where: mock((condition: unknown) => {
      onWhere?.(condition);
      return makeThenableChain(rows);
    }),
    ...makeThenableChain(rows),
  });

  const db = {
    select: mock(() => ({
      from: mock((table: unknown) => {
        // Use reference equality against imported schema tables
        if (table === schema.anomalyBaselines) {
          return makeWhereChain(baselineFromDb ? [baselineFromDb] : []);
        }
        if (table === schema.anomalyConfigurations) {
          return makeWhereChain(configRecord ? [{ config: configRecord }] : []);
        }
        if (table === schema.anomalyAssignments) {
          return makeWhereChain(assignmentRecord ? [{ config: assignmentRecord }] : []);
        }
        if (table === schema.anomalies) {
          return makeWhereChain(existingAnomaly ? [existingAnomaly] : [], (c) =>
            anomalyWheres.push(c),
          );
        }
        return makeWhereChain([]);
      }),
    })),
    insert: mock((_table: unknown) => ({
      values: mock((values: Record<string, unknown>) => {
        insertCalls.push(values);
        return {
          onConflictDoUpdate: mock(() => ({
            returning: mock(() => Promise.resolve([{ config: values.config }])),
          })),
          returning: mock(() =>
            Promise.resolve([{ id: `anomaly-${insertCalls.length}` }]),
          ),
        };
      }),
    })),
    update: mock((_table: unknown) => ({
      set: mock((setValues: Record<string, unknown>) => ({
        where: mock(() => {
          updateCalls.push(setValues);
          return Promise.resolve();
        }),
      })),
    })),
    delete: mock((_table: unknown) => ({
      where: mock(() => {
        deleteCalls.push(true);
        return Promise.resolve();
      }),
    })),
    _insertCalls: insertCalls,
    _updateCalls: updateCalls,
    _deleteCalls: deleteCalls,
    _anomalyWheres: anomalyWheres,
  };

  return db;
}

/**
 * Flattens a drizzle SQL condition (from `and`/`eq`/`isNull`) into a readable
 * string by walking its `queryChunks`, so a test can assert the per-env lookup
 * predicate ("environment_id = env-prod" vs "environment_id is null") without a
 * live database.
 */
function serializeCondition(cond: unknown): string {
  if (cond === null || cond === undefined || typeof cond !== "object") {
    return String(cond);
  }
  const c = cond as Record<string, unknown>;
  if (Array.isArray(c.queryChunks)) {
    return c.queryChunks.map(serializeCondition).join("");
  }
  // StringChunk: `value` is a string[] (e.g. [" = "], [" is null"]).
  if (Array.isArray(c.value)) {
    return (c.value as unknown[]).join("");
  }
  // Column reference (PgText etc.).
  if (typeof c.name === "string") return c.name;
  // Bound Param: `value` is the scalar.
  if ("value" in c) return String(c.value);
  return "";
}

// Real schemas registered with healthcheck-common's healthResultRegistry, so
// detector.ts's getHealthResultMeta() lookup resolves x-anomaly-direction.
const mockResultSchema = healthResultSchema({
  responseTimeMs: healthResultNumber({
    "x-chart-type": "line",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "lower-is-better",
  }),
  statusCode: healthResultNumber({
    "x-chart-type": "counter",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "deviation",
  }),
  availability: healthResultNumber({
    "x-chart-type": "gauge",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "higher-is-better",
  }),
  bodyText: healthResultString({
    "x-chart-type": "text",
    "x-anomaly-enabled": false,
  }),
  statusText: healthResultString({
    "x-chart-type": "status",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "dominance",
  }),
  isRunning: healthResultBoolean({
    "x-chart-type": "boolean",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "dominance",
  }),
});

const createMockCollectorRegistry = (): CollectorRegistry => {
  const registered = {
    qualifiedId: "http.request",
    collector: {
      result: { schema: mockResultSchema },
    },
    ownerPlugin: { id: "healthcheck-http", name: "HTTP" },
  } as unknown as RegisteredCollector;

  return {
    register: mock(() => {}),
    getCollector: mock(() => registered),
    getCollectorsForPlugin: mock(() => [registered]),
    getCollectors: mock(() => [registered]),
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const systemId = "sys-1";
const configurationId = "config-1";
const timestamp = new Date().toISOString();
const cacheKeyPrefix = `baseline:${configurationId}:${systemId}:<none>:collectors.http.request.responseTimeMs`;

const anomalousResult = {
  "uuid-1": {
    _collectorId: "http.request",
    responseTimeMs: 200, // 10σ above mean=100, stdDev=10
  },
};
const normalResult = {
  "uuid-1": {
    _collectorId: "http.request",
    responseTimeMs: 105, // Within 100 ± 30
  },
};

const baseProps = {
  systemId,
  configurationId,
  status: "healthy",
  timestamp,
  collectorRegistry: createMockCollectorRegistry(),
};

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Anomaly Detector — processCheckCompleted", () => {
  // ─── Early exit conditions ─────────────────────────────────────────────

  test("skips processing when result is undefined", async () => {
    const cache = createMockCache();
    await processCheckCompleted({
      ...baseProps,
      latencyMs: 50,
      result: undefined,
      db: createMockDb() as never,
      cache,
      logger: createMockLogger() as never,
      catalogClient: createMockCatalogClient() as never,
      notificationClient: createMockNotificationClient() as never,
    });
    expect(cache.get).not.toHaveBeenCalled();
  });

  test("skips processing when status is not healthy", async () => {
    const cache = createMockCache();
    await processCheckCompleted({
      ...baseProps,
      status: "unhealthy",
      latencyMs: undefined,
      result: anomalousResult,
      db: createMockDb() as never,
      cache,
      logger: createMockLogger() as never,
      catalogClient: createMockCatalogClient() as never,
      notificationClient: createMockNotificationClient() as never,
    });
    expect(cache.get).not.toHaveBeenCalled();
  });

  test("processes categorical fields (string/boolean)", async () => {
    const cache = createMockCache(new Map());
    const db = createMockDb();
    await processCheckCompleted({
      ...baseProps,
      latencyMs: 50,
      result: {
        "uuid-1": { _collectorId: "http.request", statusText: "OK", isRunning: true },
      },
      db: db as never,
      cache,
      logger: createMockLogger() as never,
      catalogClient: createMockCatalogClient() as never,
      notificationClient: createMockNotificationClient() as never,
    });
    // Two fields (statusText, isRunning) means cache.get should be called twice
    expect(cache.get).toHaveBeenCalledTimes(2);
  });

  test("creates suspicious anomaly for dominance drift", async () => {
    const baseline = createBaseline({ dominantValue: "OK", dominantRatio: 0.95 });
    const cacheKey = `baseline:${configurationId}:${systemId}:<none>:collectors.http.request.statusText`;
    const cache = createMockCache(new Map([[cacheKey, baseline]]));
    const db = createMockDb();
    
    await processCheckCompleted({
      ...baseProps,
      latencyMs: 50,
      result: {
        "uuid-1": { _collectorId: "http.request", statusText: "ERROR" },
      },
      db: db as never,
      cache,
      logger: createMockLogger() as never,
      catalogClient: createMockCatalogClient() as never,
      notificationClient: createMockNotificationClient() as never,
    });
    
    expect(db._insertCalls.length).toBe(1);
    expect(db._insertCalls[0]).toMatchObject({
      state: "suspicious",
      direction: "above", // Categorical defaults to "above"
      observedValue: "ERROR",
      deviation: 0,
      suspiciousRunCount: 1,
    });
  });

  // ─── Learning phase (no baseline) ─────────────────────────────────────

  test("skips field with no baseline (learning phase)", async () => {
    const cache = createMockCache(new Map());
    const db = createMockDb();
    await processCheckCompleted({
      ...baseProps,
      latencyMs: 50,
      result: anomalousResult,
      db: db as never,
      cache,
      logger: createMockLogger() as never,
      catalogClient: createMockCatalogClient() as never,
      notificationClient: createMockNotificationClient() as never,
    });
    expect(cache.get).toHaveBeenCalledTimes(1);
    expect(db._insertCalls.length).toBe(0);
  });

  // ─── Normal value → no anomaly ────────────────────────────────────────

  test("does not create anomaly for value within normal bounds", async () => {
    const baseline = createBaseline({ mean: 100, stdDev: 10 });
    const cache = createMockCache(new Map([[cacheKeyPrefix, baseline]]));
    const db = createMockDb();
    await processCheckCompleted({
      ...baseProps,
      latencyMs: 50,
      result: normalResult,
      db: db as never,
      cache,
      logger: createMockLogger() as never,
      catalogClient: createMockCatalogClient() as never,
      notificationClient: createMockNotificationClient() as never,
    });
    expect(db._insertCalls.length).toBe(0);
  });

  // ─── Anomalous value → create suspicious ──────────────────────────────

  test("creates suspicious anomaly for value outside bounds", async () => {
    const baseline = createBaseline({ mean: 100, stdDev: 10 });
    const cache = createMockCache(new Map([[cacheKeyPrefix, baseline]]));
    const db = createMockDb();
    await processCheckCompleted({
      ...baseProps,
      latencyMs: 50,
      result: anomalousResult,
      db: db as never,
      cache,
      logger: createMockLogger() as never,
      catalogClient: createMockCatalogClient() as never,
      notificationClient: createMockNotificationClient() as never,
    });
    expect(db._insertCalls.length).toBe(1);
    expect(db._insertCalls[0]).toMatchObject({
      state: "suspicious",
      direction: "above",
      suspiciousRunCount: 1,
      systemId,
      configurationId,
    });
  });

  // ─── Suspicious → confirmed → notification dispatch ───────────────────

  test("confirms anomaly and dispatches Sidecar notification", async () => {
    const baseline = createBaseline({ mean: 100, stdDev: 10 });
    const cache = createMockCache(new Map([[cacheKeyPrefix, baseline]]));
    const catalogClient = createMockCatalogClient();
    const notificationClient = createMockNotificationClient(["user-1"]);
    const db = createMockDb({
      existingAnomaly: {
        id: "anomaly-existing",
        systemId,
        configurationId,
        fieldPath: "collectors.http.request.responseTimeMs",
        state: "suspicious",
        suspiciousRunCount: 2,
        confirmationThreshold: 3,
      },
    });

    await processCheckCompleted({
      ...baseProps,
      latencyMs: 50,
      result: anomalousResult,
      db: db as never,
      cache,
      logger: createMockLogger() as never,
      catalogClient: catalogClient as never,
      notificationClient: notificationClient as never,
    });

    expect(db._updateCalls.length).toBe(1);
    expect(db._updateCalls[0]).toMatchObject({ state: "anomaly" });

    expect(notificationClient.notifyForSubscription).toHaveBeenCalledTimes(1);
    const notifArgs = (notificationClient.notifyForSubscription as Mock<(...args: unknown[]) => unknown>).mock.calls[0] as unknown[];
    const notifPayload = notifArgs[0] as Record<string, unknown>;
    expect(notifPayload).toMatchObject({
      specId: "anomaly.system",
      resourceKeys: [systemId],
      importance: "warning",
    });
    expect(notifPayload.title).toContain("Anomaly Detected");
  });

  // ─── Recovery → info notification ─────────────────────────────────────

  test("recovers anomaly and dispatches info notification", async () => {
    const baseline = createBaseline({ mean: 100, stdDev: 10 });
    const cache = createMockCache(new Map([[cacheKeyPrefix, baseline]]));
    const catalogClient = createMockCatalogClient();
    const notificationClient = createMockNotificationClient(["user-1"]);
    const db = createMockDb({
      existingAnomaly: {
        id: "anomaly-confirmed",
        systemId,
        configurationId,
        fieldPath: "collectors.http.request.responseTimeMs",
        state: "anomaly",
        suspiciousRunCount: 5,
        confirmationThreshold: 3,
      },
    });

    await processCheckCompleted({
      ...baseProps,
      latencyMs: 50,
      result: normalResult,
      db: db as never,
      cache,
      logger: createMockLogger() as never,
      catalogClient: catalogClient as never,
      notificationClient: notificationClient as never,
    });

    expect(db._updateCalls.length).toBe(1);
    expect(db._updateCalls[0]).toMatchObject({ state: "recovered" });

    expect(notificationClient.notifyForSubscription).toHaveBeenCalledTimes(1);
    const notifArgs = (notificationClient.notifyForSubscription as Mock<(...args: unknown[]) => unknown>).mock.calls[0] as unknown[];
    const notifPayload = notifArgs[0] as Record<string, unknown>;
    expect(notifPayload).toMatchObject({
      specId: "anomaly.system",
      resourceKeys: [systemId],
      importance: "info",
    });
    expect(notifPayload.title).toContain("Recovered");
  });

  // ─── Transient spike → deleted ────────────────────────────────────────

  test("deletes suspicious record when value returns to normal", async () => {
    const baseline = createBaseline({ mean: 100, stdDev: 10 });
    const cache = createMockCache(new Map([[cacheKeyPrefix, baseline]]));
    const db = createMockDb({
      existingAnomaly: {
        id: "anomaly-transient",
        systemId,
        configurationId,
        fieldPath: "collectors.http.request.responseTimeMs",
        state: "suspicious",
        suspiciousRunCount: 1,
        confirmationThreshold: 3,
      },
    });

    await processCheckCompleted({
      ...baseProps,
      latencyMs: 50,
      result: normalResult,
      db: db as never,
      cache,
      logger: createMockLogger() as never,
      catalogClient: createMockCatalogClient() as never,
      notificationClient: createMockNotificationClient() as never,
    });

    expect(db._deleteCalls.length).toBe(1);
  });

  // Regression: a cleared suspicion is a dashboard-visible state going away.
  // It used to delete the row silently — no cache drop, no signal — so the
  // "Suspicious behaviour" badge/signal stayed on screen until an incidental
  // refetch. It must invalidate and broadcast like every other transition.
  test("invalidates the router cache and broadcasts 'cleared' when a suspicion clears", async () => {
    const baseline = createBaseline({ mean: 100, stdDev: 10 });
    const cache = createMockCache(new Map([[cacheKeyPrefix, baseline]]));
    const broadcast = mock(async () => {});
    const signalService = { broadcast } as never;
    const invalidateAnomalies = mock(async () => 0);
    const db = createMockDb({
      existingAnomaly: {
        id: "anomaly-transient",
        systemId,
        configurationId,
        fieldPath: "collectors.http.request.responseTimeMs",
        state: "suspicious",
        suspiciousRunCount: 1,
        confirmationThreshold: 3,
      },
    });

    await processCheckCompleted({
      ...baseProps,
      latencyMs: 50,
      result: normalResult,
      db: db as never,
      cache,
      routerCache: { invalidateAnomalies },
      logger: createMockLogger() as never,
      catalogClient: createMockCatalogClient() as never,
      notificationClient: createMockNotificationClient() as never,
      signalService,
    });

    expect(db._deleteCalls.length).toBe(1);
    expect(invalidateAnomalies).toHaveBeenCalledTimes(1);
    expect(broadcast).toHaveBeenCalledTimes(1);
    const broadcastArgs = (broadcast as Mock<(...args: unknown[]) => unknown>).mock.calls[0] as unknown[];
    expect(broadcastArgs[1] as Record<string, unknown>).toMatchObject({
      systemId,
      anomalyId: "anomaly-transient",
      newState: "cleared",
    });
  });

  // A suspicion that never fired a "confirmed" notification must not fire a
  // "recovered" one either — hence `cleared` rather than reusing `recovered`.
  test("clearing a suspicion sends no notification", async () => {
    const baseline = createBaseline({ mean: 100, stdDev: 10 });
    const cache = createMockCache(new Map([[cacheKeyPrefix, baseline]]));
    const notificationClient = createMockNotificationClient();
    const db = createMockDb({
      existingAnomaly: {
        id: "anomaly-transient",
        systemId,
        configurationId,
        fieldPath: "collectors.http.request.responseTimeMs",
        state: "suspicious",
        suspiciousRunCount: 1,
        confirmationThreshold: 3,
      },
    });

    await processCheckCompleted({
      ...baseProps,
      latencyMs: 50,
      result: normalResult,
      db: db as never,
      cache,
      logger: createMockLogger() as never,
      catalogClient: createMockCatalogClient() as never,
      notificationClient: notificationClient as never,
    });

    expect(notificationClient.notifyForSubscription).not.toHaveBeenCalled();
  });

  // ─── Config disabled ──────────────────────────────────────────────────

  test("skips processing when config is disabled", async () => {
    const baseline = createBaseline();
    const cache = createMockCache(new Map([[cacheKeyPrefix, baseline]]));
    const db = createMockDb({
      configRecord: {
        version: 1,
        data: { enabled: false, baselineWindow: "7d", notify: true } satisfies AnomalySettings,
      },
    });

    await processCheckCompleted({
      ...baseProps,
      latencyMs: 50,
      result: anomalousResult,
      db: db as never,
      cache,
      logger: createMockLogger() as never,
      catalogClient: createMockCatalogClient() as never,
      notificationClient: createMockNotificationClient() as never,
    });

    expect(db._insertCalls.length).toBe(0);
  });

  // ─── Field path extraction ────────────────────────────────────────────

  test("correctly builds field paths from collector results", async () => {
    const baseline = createBaseline();
    const path1 = `baseline:${configurationId}:${systemId}:<none>:collectors.http.request.responseTimeMs`;
    const path2 = `baseline:${configurationId}:${systemId}:<none>:collectors.http.request.statusCode`;
    const cache = createMockCache(new Map([[path1, baseline], [path2, baseline]]));

    await processCheckCompleted({
      ...baseProps,
      latencyMs: 50,
      result: {
        "uuid-1": {
          _collectorId: "http.request",
          responseTimeMs: 105,
          statusCode: 200,
          _assertionFailed: undefined,
        },
      },
      db: createMockDb() as never,
      cache,
      logger: createMockLogger() as never,
      catalogClient: createMockCatalogClient() as never,
      notificationClient: createMockNotificationClient() as never,
    });

    expect(cache.get).toHaveBeenCalledTimes(2);
    expect(cache.get).toHaveBeenCalledWith(path1);
    expect(cache.get).toHaveBeenCalledWith(path2);
  });

  // ─── Cache miss → DB fallback ─────────────────────────────────────────

  test("falls back to DB when cache misses and repopulates cache", async () => {
    const cache = createMockCache(new Map());
    const db = createMockDb({
      baselineFromDb: {
        mean: 100,
        stdDev: 10,
        trendSlope: 0,
        sampleCount: 50,
        computedAt: new Date("2026-04-28T00:00:00.000Z"),
        dominantValue: undefined,
        dominantRatio: undefined,
      },
    });

    await processCheckCompleted({
      ...baseProps,
      latencyMs: 50,
      result: normalResult,
      db: db as never,
      cache,
      logger: createMockLogger() as never,
      catalogClient: createMockCatalogClient() as never,
      notificationClient: createMockNotificationClient() as never,
    });

    expect(cache.set).toHaveBeenCalledTimes(1);
    const setCalls = (cache.set as Mock<(...args: unknown[]) => unknown>).mock.calls;
    const firstSetCall = setCalls[0] as unknown[];
    expect(firstSetCall[0]).toContain("baseline:");
    expect(firstSetCall[2]).toBe(1000 * 60 * 60); // 1 hour TTL
  });

  // ─── Schema-direction resolution (refactor-specific edge cases) ───────

  test("resolves higher-is-better direction from schema (value below mean is anomalous)", async () => {
    const baseline = createBaseline({ mean: 99, stdDev: 1 });
    const cacheKey = `baseline:${configurationId}:${systemId}:<none>:collectors.http.request.availability`;
    const cache = createMockCache(new Map([[cacheKey, baseline]]));
    const db = createMockDb();

    await processCheckCompleted({
      ...baseProps,
      latencyMs: 50,
      result: {
        "uuid-1": { _collectorId: "http.request", availability: 50 }, // far below 99
      },
      db: db as never,
      cache,
      logger: createMockLogger() as never,
      catalogClient: createMockCatalogClient() as never,
      notificationClient: createMockNotificationClient() as never,
    });

    expect(db._insertCalls.length).toBe(1);
    expect(db._insertCalls[0]).toMatchObject({
      state: "suspicious",
      direction: "below",
    });
  });

  test("higher-is-better ignores values above the mean", async () => {
    const baseline = createBaseline({ mean: 95, stdDev: 1 });
    const cacheKey = `baseline:${configurationId}:${systemId}:<none>:collectors.http.request.availability`;
    const cache = createMockCache(new Map([[cacheKey, baseline]]));
    const db = createMockDb();

    await processCheckCompleted({
      ...baseProps,
      latencyMs: 50,
      result: {
        "uuid-1": { _collectorId: "http.request", availability: 100 }, // above mean — that's good
      },
      db: db as never,
      cache,
      logger: createMockLogger() as never,
      catalogClient: createMockCatalogClient() as never,
      notificationClient: createMockNotificationClient() as never,
    });

    expect(db._insertCalls.length).toBe(0);
  });

  test("resolves deviation direction (value far from mean in either direction is anomalous)", async () => {
    const baseline = createBaseline({ mean: 200, stdDev: 5 });
    const cacheKey = `baseline:${configurationId}:${systemId}:<none>:collectors.http.request.statusCode`;
    const cache = createMockCache(new Map([[cacheKey, baseline]]));
    const db = createMockDb();

    await processCheckCompleted({
      ...baseProps,
      latencyMs: 50,
      result: {
        "uuid-1": { _collectorId: "http.request", statusCode: 500 }, // far from 200
      },
      db: db as never,
      cache,
      logger: createMockLogger() as never,
      catalogClient: createMockCatalogClient() as never,
      notificationClient: createMockNotificationClient() as never,
    });

    expect(db._insertCalls.length).toBe(1);
    expect(db._insertCalls[0]).toMatchObject({ state: "suspicious" });
  });

  test("skips fields where schema has anomaly-enabled: false and config has no direction", async () => {
    const baseline = createBaseline({ mean: 100, stdDev: 10 });
    const cacheKey = `baseline:${configurationId}:${systemId}:<none>:collectors.http.request.bodyText`;
    const cache = createMockCache(new Map([[cacheKey, baseline]]));
    const db = createMockDb();

    await processCheckCompleted({
      ...baseProps,
      latencyMs: 50,
      result: {
        "uuid-1": { _collectorId: "http.request", bodyText: "anything" },
      },
      db: db as never,
      cache,
      logger: createMockLogger() as never,
      catalogClient: createMockCatalogClient() as never,
      notificationClient: createMockNotificationClient() as never,
    });

    // Baseline lookup happens, but direction resolution short-circuits before insert.
    expect(db._insertCalls.length).toBe(0);
  });

  test("skips when collector is not registered in collectorRegistry", async () => {
    const baseline = createBaseline({ mean: 100, stdDev: 10 });
    const cache = createMockCache(new Map([[cacheKeyPrefix, baseline]]));
    const db = createMockDb();
    const emptyRegistry = {
      register: mock(() => {}),
      getCollector: mock(() => undefined),
      getCollectorsForPlugin: mock(() => []),
      getCollectors: mock(() => []),
    } as unknown as import("@checkstack/backend-api").CollectorRegistry;

    await processCheckCompleted({
      ...baseProps,
      collectorRegistry: emptyRegistry,
      latencyMs: 50,
      result: anomalousResult,
      db: db as never,
      cache,
      logger: createMockLogger() as never,
      catalogClient: createMockCatalogClient() as never,
      notificationClient: createMockNotificationClient() as never,
    });

    // No schema direction available, no config direction → silently skipped
    expect(db._insertCalls.length).toBe(0);
  });

  // ─── State machine edge cases ─────────────────────────────────────────

  test("increments suspiciousRunCount without crossing confirmation threshold", async () => {
    const baseline = createBaseline({ mean: 100, stdDev: 10 });
    const cache = createMockCache(new Map([[cacheKeyPrefix, baseline]]));
    const db = createMockDb({
      existingAnomaly: {
        id: "anomaly-counting",
        systemId,
        configurationId,
        fieldPath: "collectors.http.request.responseTimeMs",
        state: "suspicious",
        suspiciousRunCount: 1,
        confirmationThreshold: 5, // Not yet reached
      },
    });

    await processCheckCompleted({
      ...baseProps,
      latencyMs: 50,
      result: anomalousResult,
      db: db as never,
      cache,
      logger: createMockLogger() as never,
      catalogClient: createMockCatalogClient() as never,
      notificationClient: createMockNotificationClient() as never,
    });

    expect(db._updateCalls.length).toBe(1);
    expect(db._updateCalls[0]).toMatchObject({ suspiciousRunCount: 2 });
    // Critically, must NOT transition to "anomaly"
    expect(db._updateCalls[0]).not.toHaveProperty("state");
  });

  test("updates observed value on already-confirmed anomaly without re-emitting", async () => {
    const baseline = createBaseline({ mean: 100, stdDev: 10 });
    const cache = createMockCache(new Map([[cacheKeyPrefix, baseline]]));
    const catalogClient = createMockCatalogClient();
    const notificationClient = createMockNotificationClient();
    const db = createMockDb({
      existingAnomaly: {
        id: "anomaly-confirmed",
        systemId,
        configurationId,
        fieldPath: "collectors.http.request.responseTimeMs",
        state: "anomaly",
        suspiciousRunCount: 5,
        confirmationThreshold: 3,
      },
    });

    await processCheckCompleted({
      ...baseProps,
      latencyMs: 50,
      result: anomalousResult,
      db: db as never,
      cache,
      logger: createMockLogger() as never,
      catalogClient: catalogClient as never,
      notificationClient: notificationClient as never,
    });

    // Should update observed value but not send another notification
    expect(db._updateCalls.length).toBe(1);
    expect(notificationClient.notifyForSubscription).not.toHaveBeenCalled();
  });

  // ─── Signal emission (F8) ─────────────────────────────────────────────

  test("broadcasts signal when suspicious anomaly is created", async () => {
    const baseline = createBaseline({ mean: 100, stdDev: 10 });
    const cache = createMockCache(new Map([[cacheKeyPrefix, baseline]]));
    const broadcast = mock(async () => {});
    const signalService = { broadcast } as never;
    const db = createMockDb();

    await processCheckCompleted({
      ...baseProps,
      latencyMs: 50,
      result: anomalousResult,
      db: db as never,
      cache,
      logger: createMockLogger() as never,
      catalogClient: createMockCatalogClient() as never,
      notificationClient: createMockNotificationClient() as never,
      signalService,
    });

    expect(broadcast).toHaveBeenCalledTimes(1);
    const broadcastArgs = (broadcast as Mock<(...args: unknown[]) => unknown>).mock.calls[0] as unknown[];
    const broadcastPayload = broadcastArgs[1] as Record<string, unknown>;
    expect(broadcastPayload).toMatchObject({ systemId, newState: "suspicious" });
  });

  test("broadcasts signal on confirmation transition", async () => {
    const baseline = createBaseline({ mean: 100, stdDev: 10 });
    const cache = createMockCache(new Map([[cacheKeyPrefix, baseline]]));
    const broadcast = mock(async () => {});
    const signalService = { broadcast } as never;
    const db = createMockDb({
      existingAnomaly: {
        id: "anomaly-existing",
        systemId,
        configurationId,
        fieldPath: "collectors.http.request.responseTimeMs",
        state: "suspicious",
        suspiciousRunCount: 2,
        confirmationThreshold: 3,
      },
    });

    await processCheckCompleted({
      ...baseProps,
      latencyMs: 50,
      result: anomalousResult,
      db: db as never,
      cache,
      logger: createMockLogger() as never,
      catalogClient: createMockCatalogClient() as never,
      notificationClient: createMockNotificationClient() as never,
      signalService,
    });

    expect(broadcast).toHaveBeenCalledTimes(1);
    const broadcastArgs = (broadcast as Mock<(...args: unknown[]) => unknown>).mock.calls[0] as unknown[];
    const broadcastPayload = broadcastArgs[1] as Record<string, unknown>;
    expect(broadcastPayload).toMatchObject({ newState: "anomaly" });
  });

  test("broadcasts signal on recovery", async () => {
    const baseline = createBaseline({ mean: 100, stdDev: 10 });
    const cache = createMockCache(new Map([[cacheKeyPrefix, baseline]]));
    const broadcast = mock(async () => {});
    const signalService = { broadcast } as never;
    const db = createMockDb({
      existingAnomaly: {
        id: "anomaly-confirmed",
        systemId,
        configurationId,
        fieldPath: "collectors.http.request.responseTimeMs",
        state: "anomaly",
        suspiciousRunCount: 5,
        confirmationThreshold: 3,
      },
    });

    await processCheckCompleted({
      ...baseProps,
      latencyMs: 50,
      result: normalResult,
      db: db as never,
      cache,
      logger: createMockLogger() as never,
      catalogClient: createMockCatalogClient() as never,
      notificationClient: createMockNotificationClient() as never,
      signalService,
    });

    expect(broadcast).toHaveBeenCalledTimes(1);
    const broadcastArgs = (broadcast as Mock<(...args: unknown[]) => unknown>).mock.calls[0] as unknown[];
    const broadcastPayload = broadcastArgs[1] as Record<string, unknown>;
    expect(broadcastPayload).toMatchObject({ newState: "recovered" });
  });

  // ─── PART A: self-resolution (settled at a new level) ─────────────────

  test("self-resolves a confirmed anomaly once recent samples settle at a new level", async () => {
    const baseline = createBaseline({ mean: 100, stdDev: 10 });
    const cache = createMockCache(new Map([[cacheKeyPrefix, baseline]]));
    const catalogClient = createMockCatalogClient();
    const notificationClient = createMockNotificationClient(["user-1"]);
    // Four prior healthy samples already sitting at the new stable level (~200);
    // the fifth (anomalousResult = 200) completes the window → self-resolve.
    const db = createMockDb({
      existingAnomaly: {
        id: "anomaly-stuck",
        systemId,
        configurationId,
        fieldPath: "collectors.http.request.responseTimeMs",
        state: "anomaly",
        suspiciousRunCount: 5,
        confirmationThreshold: 3,
        baselineValue: 100,
        observedValue: "200",
        suppressedAt: null,
        suppressedValue: null,
        metadata: { recentSamples: [200, 200, 200, 200] },
      },
    });

    await processCheckCompleted({
      ...baseProps,
      latencyMs: 50,
      result: anomalousResult, // still 10σ above the stale baseline
      db: db as never,
      cache,
      logger: createMockLogger() as never,
      catalogClient: catalogClient as never,
      notificationClient: notificationClient as never,
    });

    expect(db._updateCalls.length).toBe(1);
    expect(db._updateCalls[0]).toMatchObject({ state: "recovered" });
    // Recovery notification is dispatched.
    expect(notificationClient.notifyForSubscription).toHaveBeenCalledTimes(1);
  });

  test("does not self-resolve while the window is still filling", async () => {
    const baseline = createBaseline({ mean: 100, stdDev: 10 });
    const cache = createMockCache(new Map([[cacheKeyPrefix, baseline]]));
    const db = createMockDb({
      existingAnomaly: {
        id: "anomaly-filling",
        systemId,
        configurationId,
        fieldPath: "collectors.http.request.responseTimeMs",
        state: "anomaly",
        suspiciousRunCount: 5,
        confirmationThreshold: 3,
        baselineValue: 100,
        observedValue: "200",
        suppressedAt: null,
        suppressedValue: null,
        metadata: { recentSamples: [200, 200] },
      },
    });

    await processCheckCompleted({
      ...baseProps,
      latencyMs: 50,
      result: anomalousResult,
      db: db as never,
      cache,
      logger: createMockLogger() as never,
      catalogClient: createMockCatalogClient() as never,
      notificationClient: createMockNotificationClient() as never,
    });

    expect(db._updateCalls.length).toBe(1);
    // Still anomalous: only the rolling window/observed value is updated.
    expect(db._updateCalls[0]).not.toHaveProperty("state");
    expect(db._updateCalls[0].metadata).toMatchObject({
      recentSamples: [200, 200, 200],
    });
  });

  // ─── PART B: auto-unsuppress ("changes again") ────────────────────────

  test("auto-unsuppresses a suppressed anomaly when the value changes again", async () => {
    const baseline = createBaseline({ mean: 100, stdDev: 10 });
    const cache = createMockCache(new Map([[cacheKeyPrefix, baseline]]));
    const db = createMockDb({
      existingAnomaly: {
        id: "anomaly-suppressed",
        systemId,
        configurationId,
        fieldPath: "collectors.http.request.responseTimeMs",
        state: "anomaly",
        suspiciousRunCount: 5,
        confirmationThreshold: 3,
        baselineValue: 100,
        observedValue: "200",
        suppressedAt: new Date(),
        suppressedValue: 200, // suppressed at ~200; new value 200 is unchanged...
        metadata: {},
      },
    });

    // anomalousResult is 200 — within band → must NOT auto-unsuppress.
    await processCheckCompleted({
      ...baseProps,
      latencyMs: 50,
      result: anomalousResult,
      db: db as never,
      cache,
      logger: createMockLogger() as never,
      catalogClient: createMockCatalogClient() as never,
      notificationClient: createMockNotificationClient() as never,
    });
    const unsuppressed = db._updateCalls.find(
      (c) => c.suppressedAt === null,
    );
    expect(unsuppressed).toBeUndefined();
  });

  test("auto-unsuppresses when the value moves outside the reactivation band", async () => {
    // Baseline far below so the new high value is still anomalous and reaches
    // the anomaly branch; suppressed at 50, observed jumps to 200 (>25% move).
    const baseline = createBaseline({ mean: 100, stdDev: 10 });
    const cache = createMockCache(new Map([[cacheKeyPrefix, baseline]]));
    const db = createMockDb({
      existingAnomaly: {
        id: "anomaly-suppressed-2",
        systemId,
        configurationId,
        fieldPath: "collectors.http.request.responseTimeMs",
        state: "anomaly",
        suspiciousRunCount: 5,
        confirmationThreshold: 3,
        baselineValue: 100,
        observedValue: "50",
        suppressedAt: new Date(),
        suppressedValue: 50,
        metadata: {},
      },
    });

    await processCheckCompleted({
      ...baseProps,
      latencyMs: 50,
      result: anomalousResult, // 200, far from suppressedValue 50
      db: db as never,
      cache,
      logger: createMockLogger() as never,
      catalogClient: createMockCatalogClient() as never,
      notificationClient: createMockNotificationClient() as never,
    });

    expect(db._updateCalls.length).toBe(1);
    expect(db._updateCalls[0]).toMatchObject({
      suppressedAt: null,
      suppressedValue: null,
    });
  });

  // ─── Notification resilience ──────────────────────────────────────────

  test("does not crash when notification dispatch fails", async () => {
    const baseline = createBaseline({ mean: 100, stdDev: 10 });
    const cache = createMockCache(new Map([[cacheKeyPrefix, baseline]]));
    const failingClient = {
      getSystem: mock(async () => {
        throw new Error("catalog unreachable");
      }),
      notifySystemSubscribers: mock(async () => ({ notifiedCount: 0 })),
    };
    const logger = createMockLogger();
    const db = createMockDb({
      existingAnomaly: {
        id: "anomaly-existing",
        systemId,
        configurationId,
        fieldPath: "collectors.http.request.responseTimeMs",
        state: "suspicious",
        suspiciousRunCount: 2,
        confirmationThreshold: 3,
      },
    });

    await processCheckCompleted({
      ...baseProps,
      latencyMs: 50,
      result: anomalousResult,
      db: db as never,
      cache,
      logger: logger as never,
      catalogClient: failingClient as never,
      notificationClient: createMockNotificationClient() as never,
    });

    // State transition still happened despite notification failure
    expect(db._updateCalls.length).toBe(1);
    expect(db._updateCalls[0]).toMatchObject({ state: "anomaly" });
    // The failure was logged at warn level
    expect(logger.warn).toHaveBeenCalled();
  });

  // ─── Environment scoping ──────────────────────────────────────────────
  //
  // Regression guard: when a run carries `environmentId`, the detector must
  // resolve the per-env baseline — the cache key gains an env segment and the
  // env-less (`<none>`) key is NOT consulted. This locks the analyzer↔detector
  // cache-key contract: a per-env baseline never shadows (or is shadowed by)
  // the env-less slice.

  test("uses env-scoped cache key when environmentId is provided", async () => {
    const baseline = createBaseline();
    const envBaselineFromDb = {
      mean: baseline.mean,
      stdDev: baseline.stdDev,
      trendSlope: baseline.trendSlope,
      sampleCount: baseline.sampleCount,
      computedAt: new Date(baseline.computedAt),
      dominantValue: null,
      dominantRatio: null,
      environmentId: "env-prod",
    };
    const db = createMockDb({ baselineFromDb: envBaselineFromDb });
    const cache = createMockCache(new Map()); // empty → forces DB lookup

    await processCheckCompleted({
      ...baseProps,
      latencyMs: 50,
      environmentId: "env-prod",
      result: anomalousResult,
      db: db as never,
      cache,
      logger: createMockLogger() as never,
      catalogClient: createMockCatalogClient() as never,
      notificationClient: createMockNotificationClient() as never,
    });

    // The cache lookup must carry the env segment, NOT the env-less `<none>`.
    const expectedKey = `baseline:${configurationId}:${systemId}:env-prod:collectors.http.request.responseTimeMs`;
    const envLessKey = `baseline:${configurationId}:${systemId}:<none>:collectors.http.request.responseTimeMs`;
    expect(cache.get).toHaveBeenCalledWith(expectedKey);
    expect(cache.get).not.toHaveBeenCalledWith(envLessKey);
    // After the DB hit, the env-scoped baseline is written back under the
    // same env-scoped key.
    expect(cache.set).toHaveBeenCalledWith(
      expectedKey,
      expect.objectContaining({ mean: baseline.mean }),
      expect.any(Number),
    );
  });

  test("falls back to env-less (<none>) cache key when environmentId is null", async () => {
    const baseline = createBaseline();
    const envKey = `baseline:${configurationId}:${systemId}:env-prod:collectors.http.request.responseTimeMs`;
    const envLessKey = `baseline:${configurationId}:${systemId}:<none>:collectors.http.request.responseTimeMs`;
    // Seed ONLY the env-less slice; the per-env key is absent. A null env run
    // must read the env-less baseline, never the per-env one.
    const cache = createMockCache(new Map([[envLessKey, baseline]]));

    await processCheckCompleted({
      ...baseProps,
      latencyMs: 50,
      environmentId: null,
      result: anomalousResult,
      db: createMockDb() as never,
      cache,
      logger: createMockLogger() as never,
      catalogClient: createMockCatalogClient() as never,
      notificationClient: createMockNotificationClient() as never,
    });

    expect(cache.get).toHaveBeenCalledWith(envLessKey);
    expect(cache.get).not.toHaveBeenCalledWith(envKey);
  });

  // ─── Per-(check, environment) anomaly ROWS (deferred #375 follow-up) ───
  //
  // Anomaly rows are now keyed by (system, config, environment, field, kind),
  // so an anomaly for a check in env A is a distinct row from env B. These
  // guards prove new rows are tagged with their env and the existing-row lookup
  // is env-scoped, so a healthy value in one env never merges with an anomaly
  // in another.

  test("tags a newly created spike anomaly with its environmentId", async () => {
    const baseline = createBaseline({ mean: 100, stdDev: 10 });
    const cacheKey = `baseline:${configurationId}:${systemId}:env-prod:collectors.http.request.responseTimeMs`;
    const cache = createMockCache(new Map([[cacheKey, baseline]]));
    const db = createMockDb();

    await processCheckCompleted({
      ...baseProps,
      latencyMs: 50,
      environmentId: "env-prod",
      result: anomalousResult,
      db: db as never,
      cache,
      logger: createMockLogger() as never,
      catalogClient: createMockCatalogClient() as never,
      notificationClient: createMockNotificationClient() as never,
    });

    expect(db._insertCalls.length).toBe(1);
    expect(db._insertCalls[0]).toMatchObject({
      state: "suspicious",
      environmentId: "env-prod",
      systemId,
      configurationId,
    });
    // The existing-row lookup was scoped to this environment.
    expect(db._anomalyWheres.length).toBe(1);
    expect(serializeCondition(db._anomalyWheres[0])).toContain(
      "environment_id = env-prod",
    );
  });

  test("env A and env B produce independent, env-tagged anomaly rows", async () => {
    const baseline = createBaseline({ mean: 100, stdDev: 10 });
    const envAKey = `baseline:${configurationId}:${systemId}:env-a:collectors.http.request.responseTimeMs`;
    const envBKey = `baseline:${configurationId}:${systemId}:env-b:collectors.http.request.responseTimeMs`;
    const cache = createMockCache(
      new Map([
        [envAKey, baseline],
        [envBKey, baseline],
      ]),
    );

    // No existing row in either env → each anomalous run inserts its own.
    const dbA = createMockDb();
    await processCheckCompleted({
      ...baseProps,
      latencyMs: 50,
      environmentId: "env-a",
      result: anomalousResult,
      db: dbA as never,
      cache,
      logger: createMockLogger() as never,
      catalogClient: createMockCatalogClient() as never,
      notificationClient: createMockNotificationClient() as never,
    });

    const dbB = createMockDb();
    await processCheckCompleted({
      ...baseProps,
      latencyMs: 50,
      environmentId: "env-b",
      result: anomalousResult,
      db: dbB as never,
      cache,
      logger: createMockLogger() as never,
      catalogClient: createMockCatalogClient() as never,
      notificationClient: createMockNotificationClient() as never,
    });

    expect(dbA._insertCalls[0]).toMatchObject({ environmentId: "env-a" });
    expect(dbB._insertCalls[0]).toMatchObject({ environmentId: "env-b" });
    // Each lookup is scoped to its own env, so an env-A row can never satisfy an
    // env-B lookup (and vice versa).
    expect(serializeCondition(dbA._anomalyWheres[0])).toContain(
      "environment_id = env-a",
    );
    expect(serializeCondition(dbB._anomalyWheres[0])).toContain(
      "environment_id = env-b",
    );
  });

  test("env-less run resolves the IS NULL slice and tags the row null", async () => {
    const baseline = createBaseline({ mean: 100, stdDev: 10 });
    const cache = createMockCache(new Map([[cacheKeyPrefix, baseline]]));
    const db = createMockDb();

    await processCheckCompleted({
      ...baseProps,
      latencyMs: 50,
      // environmentId omitted → defaults to null (env-less slice).
      result: anomalousResult,
      db: db as never,
      cache,
      logger: createMockLogger() as never,
      catalogClient: createMockCatalogClient() as never,
      notificationClient: createMockNotificationClient() as never,
    });

    expect(db._insertCalls[0]).toMatchObject({ environmentId: null });
    expect(serializeCondition(db._anomalyWheres[0])).toContain(
      "environment_id is null",
    );
    expect(serializeCondition(db._anomalyWheres[0])).not.toContain(
      "environment_id =",
    );
  });

  test("env-less run updates only the env-less row (never an env-scoped one)", async () => {
    const baseline = createBaseline({ mean: 100, stdDev: 10 });
    const cache = createMockCache(new Map([[cacheKeyPrefix, baseline]]));
    // An env-less confirmed row exists; a fresh normal env-less run recovers it.
    const db = createMockDb({
      existingAnomaly: {
        id: "anomaly-env-less",
        systemId,
        configurationId,
        environmentId: null,
        fieldPath: "collectors.http.request.responseTimeMs",
        state: "anomaly",
        suspiciousRunCount: 5,
        confirmationThreshold: 3,
      },
    });

    await processCheckCompleted({
      ...baseProps,
      latencyMs: 50,
      environmentId: null,
      result: normalResult,
      db: db as never,
      cache,
      logger: createMockLogger() as never,
      catalogClient: createMockCatalogClient() as never,
      notificationClient: createMockNotificationClient() as never,
    });

    expect(serializeCondition(db._anomalyWheres[0])).toContain(
      "environment_id is null",
    );
    expect(db._updateCalls[0]).toMatchObject({ state: "recovered" });
  });

  test("env-qualified collapse key keeps two envs as independent cards", async () => {
    const baseline = createBaseline({ mean: 100, stdDev: 10 });
    const cacheKey = `baseline:${configurationId}:${systemId}:env-prod:collectors.http.request.responseTimeMs`;
    const cache = createMockCache(new Map([[cacheKey, baseline]]));
    const notificationClient = createMockNotificationClient(["user-1"]);
    const db = createMockDb({
      existingAnomaly: {
        id: "anomaly-existing",
        systemId,
        configurationId,
        environmentId: "env-prod",
        fieldPath: "collectors.http.request.responseTimeMs",
        state: "suspicious",
        suspiciousRunCount: 2,
        confirmationThreshold: 3,
      },
    });

    await processCheckCompleted({
      ...baseProps,
      latencyMs: 50,
      environmentId: "env-prod",
      result: anomalousResult,
      db: db as never,
      cache,
      logger: createMockLogger() as never,
      catalogClient: createMockCatalogClient() as never,
      notificationClient: notificationClient as never,
    });

    const notifArgs = (
      notificationClient.notifyForSubscription as Mock<
        (...args: unknown[]) => unknown
      >
    ).mock.calls[0] as unknown[];
    const notifPayload = notifArgs[0] as Record<string, unknown>;
    // Env is appended to the collapse key so env-prod stays distinct from
    // another env's card (and from the env-less two-segment key).
    expect(notifPayload.collapseKey).toBe(
      `anomaly.anomaly.${systemId}.collectors.http.request.responseTimeMs.env-prod`,
    );
  });

  // ─── Batching regression: set-based existing-anomaly read ─────────────
  //
  // The existing 'spike' rows are pre-loaded ONCE for the whole
  // (system, config, env) slice before the field loop, then looked up per
  // field in memory. The number of anomalies-table SELECTs must NOT scale with
  // the field count — it is exactly one regardless of how many fields the run
  // carries. `_anomalyWheres` records one entry per anomalies SELECT.

  test("issues exactly ONE anomalies SELECT regardless of field count", async () => {
    const baseline = createBaseline({ mean: 100, stdDev: 10 });
    // Two numeric fields, both with baselines, both anomalous: responseTimeMs
    // (lower-is-better, above) and availability (higher-is-better, below).
    const rtKey = `baseline:${configurationId}:${systemId}:<none>:collectors.http.request.responseTimeMs`;
    const availKey = `baseline:${configurationId}:${systemId}:<none>:collectors.http.request.availability`;
    const cache = createMockCache(
      new Map([
        [rtKey, baseline],
        [availKey, createBaseline({ mean: 99, stdDev: 1 })],
      ]),
    );
    const db = createMockDb();

    await processCheckCompleted({
      ...baseProps,
      latencyMs: 50,
      result: {
        "uuid-1": {
          _collectorId: "http.request",
          responseTimeMs: 200, // anomalous (above)
          availability: 50, // anomalous (below)
        },
      },
      db: db as never,
      cache,
      logger: createMockLogger() as never,
      catalogClient: createMockCatalogClient() as never,
      notificationClient: createMockNotificationClient() as never,
    });

    // Both fields inserted a suspicious anomaly...
    expect(db._insertCalls.length).toBe(2);
    // ...but the existing-row read was a SINGLE set-based SELECT, not one per
    // field. This is the N+1 fix: it does not scale with field count.
    expect(db._anomalyWheres.length).toBe(1);
    // The single SELECT scopes to the 'spike' kind and this env slice.
    expect(serializeCondition(db._anomalyWheres[0])).toContain("kind = spike");
    expect(serializeCondition(db._anomalyWheres[0])).toContain(
      "environment_id is null",
    );
  });

  test("env-less confirmation uses the pre-feature two-segment collapse key", async () => {
    const baseline = createBaseline({ mean: 100, stdDev: 10 });
    const cache = createMockCache(new Map([[cacheKeyPrefix, baseline]]));
    const notificationClient = createMockNotificationClient(["user-1"]);
    const db = createMockDb({
      existingAnomaly: {
        id: "anomaly-existing",
        systemId,
        configurationId,
        environmentId: null,
        fieldPath: "collectors.http.request.responseTimeMs",
        state: "suspicious",
        suspiciousRunCount: 2,
        confirmationThreshold: 3,
      },
    });

    await processCheckCompleted({
      ...baseProps,
      latencyMs: 50,
      environmentId: null,
      result: anomalousResult,
      db: db as never,
      cache,
      logger: createMockLogger() as never,
      catalogClient: createMockCatalogClient() as never,
      notificationClient: notificationClient as never,
    });

    const notifArgs = (
      notificationClient.notifyForSubscription as Mock<
        (...args: unknown[]) => unknown
      >
    ).mock.calls[0] as unknown[];
    const notifPayload = notifArgs[0] as Record<string, unknown>;
    expect(notifPayload.collapseKey).toBe(
      `anomaly.anomaly.${systemId}.collectors.http.request.responseTimeMs`,
    );
  });
});
