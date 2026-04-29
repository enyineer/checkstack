import { describe, test, expect, mock } from "bun:test";
import { evaluateDrift } from "./drift-evaluator";
import * as schema from "./schema";
import type { AnomalySettings, FieldBaseline } from "@checkstack/anomaly-common";

function createBaseline(overrides: Partial<FieldBaseline> = {}): FieldBaseline {
  return {
    mean: 100,
    stdDev: 10,
    trendSlope: 0,
    sampleCount: 100,
    computedAt: "2026-04-29T00:00:00.000Z",
    ...overrides,
  };
}

function createMockCatalogClient() {
  return {
    getSystem: mock(async () => ({ name: "Test System" })),
    notifySystemSubscribers: mock(async () => ({ notifiedCount: 0 })),
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

function createMockSignalService() {
  return {
    broadcast: mock(async () => {}),
  };
}

function createMockDb({ existingAnomaly }: { existingAnomaly?: Record<string, unknown> } = {}) {
  const insertCalls: Array<Record<string, unknown>> = [];
  const updateCalls: Array<Record<string, unknown>> = [];
  const deleteCalls: unknown[] = [];

  const makeThenable = (rows: unknown[]) => {
    const promise = Promise.resolve(rows);
    return {
      then: promise.then.bind(promise),
      catch: promise.catch.bind(promise),
      limit: mock(() => Promise.resolve(rows)),
    };
  };
  const makeWhereChain = (rows: unknown[]) => ({
    where: mock(() => makeThenable(rows)),
    ...makeThenable(rows),
  });

  const db = {
    select: mock(() => ({
      from: mock((table: unknown) => {
        if (table === schema.anomalies) {
          return makeWhereChain(existingAnomaly ? [existingAnomaly] : []);
        }
        return makeWhereChain([]);
      }),
    })),
    insert: mock(() => ({
      values: mock((values: Record<string, unknown>) => {
        insertCalls.push(values);
        return {
          returning: mock(() =>
            Promise.resolve([{ id: `drift-${insertCalls.length}` }]),
          ),
        };
      }),
    })),
    update: mock(() => ({
      set: mock((setValues: Record<string, unknown>) => ({
        where: mock(() => {
          updateCalls.push(setValues);
          return Promise.resolve();
        }),
      })),
    })),
    delete: mock(() => ({
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

const baseProps = {
  systemId: "sys-1",
  configurationId: "config-1",
  fieldPath: "collectors.http.request.responseTimeMs",
};

const driftingBaseline = createBaseline({
  mean: 200,
  stdDev: 10,
  trendSlope: 1.5, // slope*n = 150 > 2*10*1 = 20 → drifts hard
  sampleCount: 100,
});
const stableBaseline = createBaseline({
  trendSlope: 0,
  sampleCount: 100,
});

const defaultTemplate: AnomalySettings = {
  enabled: true,
  sensitivity: 1,
  confirmationWindow: 3,
  baselineWindow: "7d",
  notify: true,
  driftEnabled: true,
  driftThreshold: 2,
};

describe("evaluateDrift", () => {
  describe("early exits", () => {
    test("does nothing when sampleCount below cold-start threshold", async () => {
      const db = createMockDb();
      await evaluateDrift({
        ...baseProps,
        baseline: createBaseline({ trendSlope: 5, stdDev: 10, sampleCount: 23 }),
        schemaDirection: "lower-is-better",
        templateConfig: defaultTemplate,
        db: db as never,
        catalogClient: createMockCatalogClient() as never,
        logger: createMockLogger() as never,
      });
      expect(db._insertCalls.length).toBe(0);
      expect(db._updateCalls.length).toBe(0);
    });

    test("does nothing when direction is dominance", async () => {
      const db = createMockDb();
      await evaluateDrift({
        ...baseProps,
        baseline: driftingBaseline,
        schemaDirection: "dominance",
        templateConfig: defaultTemplate,
        db: db as never,
        catalogClient: createMockCatalogClient() as never,
        logger: createMockLogger() as never,
      });
      expect(db._insertCalls.length).toBe(0);
    });

    test("does nothing when driftEnabled is false", async () => {
      const db = createMockDb();
      await evaluateDrift({
        ...baseProps,
        baseline: driftingBaseline,
        schemaDirection: "lower-is-better",
        templateConfig: { ...defaultTemplate, driftEnabled: false },
        db: db as never,
        catalogClient: createMockCatalogClient() as never,
        logger: createMockLogger() as never,
      });
      expect(db._insertCalls.length).toBe(0);
    });

    test("does nothing when overall anomaly enabled is false", async () => {
      const db = createMockDb();
      await evaluateDrift({
        ...baseProps,
        baseline: driftingBaseline,
        schemaDirection: "lower-is-better",
        templateConfig: { ...defaultTemplate, enabled: false },
        db: db as never,
        catalogClient: createMockCatalogClient() as never,
        logger: createMockLogger() as never,
      });
      expect(db._insertCalls.length).toBe(0);
    });

    test("does nothing when no direction available", async () => {
      const db = createMockDb();
      await evaluateDrift({
        ...baseProps,
        baseline: driftingBaseline,
        schemaDirection: undefined,
        templateConfig: defaultTemplate,
        db: db as never,
        catalogClient: createMockCatalogClient() as never,
        logger: createMockLogger() as never,
      });
      expect(db._insertCalls.length).toBe(0);
    });
  });

  describe("state transitions", () => {
    test("inserts a suspicious row when drift first detected", async () => {
      const db = createMockDb();
      const signalService = createMockSignalService();
      await evaluateDrift({
        ...baseProps,
        baseline: driftingBaseline,
        schemaDirection: "lower-is-better",
        templateConfig: defaultTemplate,
        db: db as never,
        catalogClient: createMockCatalogClient() as never,
        logger: createMockLogger() as never,
        signalService: signalService as never,
      });
      expect(db._insertCalls.length).toBe(1);
      const inserted = db._insertCalls[0];
      expect(inserted.kind).toBe("drift");
      expect(inserted.state).toBe("suspicious");
      expect(inserted.suspiciousRunCount).toBe(1);
      expect(inserted.confirmationThreshold).toBe(2);
      expect(inserted.direction).toBe("above");
      expect(signalService.broadcast).toHaveBeenCalledTimes(1);
    });

    test("increments count on second drifting analyzer run while still suspicious", async () => {
      const existing = {
        id: "drift-1",
        state: "suspicious",
        suspiciousRunCount: 1,
        confirmationThreshold: 3, // not 2 — verifies confirmationThreshold from row, not const
      };
      const db = createMockDb({ existingAnomaly: existing });
      await evaluateDrift({
        ...baseProps,
        baseline: driftingBaseline,
        schemaDirection: "lower-is-better",
        templateConfig: defaultTemplate,
        db: db as never,
        catalogClient: createMockCatalogClient() as never,
        logger: createMockLogger() as never,
      });
      expect(db._updateCalls.length).toBe(1);
      expect(db._updateCalls[0].suspiciousRunCount).toBe(2);
      expect(db._updateCalls[0].state).toBeUndefined(); // not promoted yet
    });

    test("promotes suspicious → anomaly + dispatches notification + broadcasts trend signal", async () => {
      const existing = {
        id: "drift-1",
        state: "suspicious",
        suspiciousRunCount: 1,
        confirmationThreshold: 2,
      };
      const db = createMockDb({ existingAnomaly: existing });
      const catalog = createMockCatalogClient();
      const signalService = createMockSignalService();
      await evaluateDrift({
        ...baseProps,
        baseline: driftingBaseline,
        schemaDirection: "lower-is-better",
        templateConfig: defaultTemplate,
        db: db as never,
        catalogClient: catalog as never,
        logger: createMockLogger() as never,
        signalService: signalService as never,
      });
      expect(db._updateCalls.length).toBe(1);
      expect(db._updateCalls[0].state).toBe("anomaly");
      expect(catalog.notifySystemSubscribers).toHaveBeenCalledTimes(1);
      // Two signals: state change + trend detected
      expect(signalService.broadcast).toHaveBeenCalledTimes(2);
    });

    test("refreshes observedValue/deviation while staying in anomaly state", async () => {
      const existing = {
        id: "drift-1",
        state: "anomaly",
        suspiciousRunCount: 2,
        confirmationThreshold: 2,
      };
      const db = createMockDb({ existingAnomaly: existing });
      const catalog = createMockCatalogClient();
      await evaluateDrift({
        ...baseProps,
        baseline: driftingBaseline,
        schemaDirection: "lower-is-better",
        templateConfig: defaultTemplate,
        db: db as never,
        catalogClient: catalog as never,
        logger: createMockLogger() as never,
      });
      expect(db._updateCalls.length).toBe(1);
      expect(db._updateCalls[0].state).toBeUndefined();
      expect(catalog.notifySystemSubscribers).not.toHaveBeenCalled();
    });

    test("deletes suspicious row when drift goes away before confirmation", async () => {
      const existing = {
        id: "drift-1",
        state: "suspicious",
        suspiciousRunCount: 1,
        confirmationThreshold: 2,
      };
      const db = createMockDb({ existingAnomaly: existing });
      await evaluateDrift({
        ...baseProps,
        baseline: stableBaseline,
        schemaDirection: "lower-is-better",
        templateConfig: defaultTemplate,
        db: db as never,
        catalogClient: createMockCatalogClient() as never,
        logger: createMockLogger() as never,
      });
      expect(db._deleteCalls.length).toBe(1);
    });

    test("transitions anomaly → recovered when drift clears + dispatches recovery", async () => {
      const existing = {
        id: "drift-1",
        state: "anomaly",
        suspiciousRunCount: 2,
        confirmationThreshold: 2,
      };
      const db = createMockDb({ existingAnomaly: existing });
      const catalog = createMockCatalogClient();
      await evaluateDrift({
        ...baseProps,
        baseline: stableBaseline,
        schemaDirection: "lower-is-better",
        templateConfig: defaultTemplate,
        db: db as never,
        catalogClient: catalog as never,
        logger: createMockLogger() as never,
      });
      expect(db._updateCalls.length).toBe(1);
      expect(db._updateCalls[0].state).toBe("recovered");
      expect(catalog.notifySystemSubscribers).toHaveBeenCalledTimes(1);
    });

    test("does nothing when no row and no drift (steady state)", async () => {
      const db = createMockDb();
      await evaluateDrift({
        ...baseProps,
        baseline: stableBaseline,
        schemaDirection: "lower-is-better",
        templateConfig: defaultTemplate,
        db: db as never,
        catalogClient: createMockCatalogClient() as never,
        logger: createMockLogger() as never,
      });
      expect(db._insertCalls.length).toBe(0);
      expect(db._updateCalls.length).toBe(0);
      expect(db._deleteCalls.length).toBe(0);
    });
  });

  describe("direction-specific behavior", () => {
    test("higher-is-better only drifts on negative slope", async () => {
      const db = createMockDb();
      // Positive slope on a higher-is-better field is improvement, not drift.
      await evaluateDrift({
        ...baseProps,
        baseline: createBaseline({ trendSlope: 1.5, stdDev: 10, sampleCount: 100, mean: 95 }),
        schemaDirection: "higher-is-better",
        templateConfig: defaultTemplate,
        db: db as never,
        catalogClient: createMockCatalogClient() as never,
        logger: createMockLogger() as never,
      });
      expect(db._insertCalls.length).toBe(0);

      const db2 = createMockDb();
      await evaluateDrift({
        ...baseProps,
        baseline: createBaseline({ trendSlope: -1.5, stdDev: 10, sampleCount: 100, mean: 95 }),
        schemaDirection: "higher-is-better",
        templateConfig: defaultTemplate,
        db: db2 as never,
        catalogClient: createMockCatalogClient() as never,
        logger: createMockLogger() as never,
      });
      expect(db2._insertCalls.length).toBe(1);
      expect(db2._insertCalls[0].direction).toBe("below");
    });
  });
});
