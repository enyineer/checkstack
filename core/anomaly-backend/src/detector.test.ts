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

  const makeWhereChain = (rows: unknown[]) => ({
    where: mock(() => makeThenableChain(rows)),
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
          return makeWhereChain(existingAnomaly ? [existingAnomaly] : []);
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
  };

  return db;
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
const cacheKeyPrefix = `baseline:${configurationId}:${systemId}:collectors.http.request.responseTimeMs`;

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
    const cacheKey = `baseline:${configurationId}:${systemId}:collectors.http.request.statusText`;
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

  // ─── Config disabled ──────────────────────────────────────────────────

  test("skips processing when config is disabled", async () => {
    const baseline = createBaseline();
    const cache = createMockCache(new Map([[cacheKeyPrefix, baseline]]));
    const db = createMockDb({
      configRecord: {
        version: 1,
        data: { enabled: false, sensitivity: 1, confirmationWindow: 3, baselineWindow: "7d", notify: true, driftEnabled: true, driftThreshold: 2 } satisfies AnomalySettings,
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
    const path1 = `baseline:${configurationId}:${systemId}:collectors.http.request.responseTimeMs`;
    const path2 = `baseline:${configurationId}:${systemId}:collectors.http.request.statusCode`;
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
    const cacheKey = `baseline:${configurationId}:${systemId}:collectors.http.request.availability`;
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
    const cacheKey = `baseline:${configurationId}:${systemId}:collectors.http.request.availability`;
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
    const cacheKey = `baseline:${configurationId}:${systemId}:collectors.http.request.statusCode`;
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
    const cacheKey = `baseline:${configurationId}:${systemId}:collectors.http.request.bodyText`;
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
});
