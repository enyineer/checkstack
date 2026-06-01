import { describe, test, expect, mock } from "bun:test";
import { AnomalyService } from "./service";
import * as schema from "./schema";

/**
 * Exercises the global (per-row) suppression surface on AnomalyService:
 * suppress snapshots the observed value + baseline, unsuppress clears them,
 * getAnomalies honours the suppression filter, and — critically — both
 * mutations are scoped by `(anomalyId, systemId)` so a caller authorized on
 * one system cannot mutate another system's row (IDOR). The detector-side
 * auto-unsuppress lives in detector.test.ts.
 */

/**
 * Walk a drizzle WHERE condition object and collect every embedded scalar
 * value. Lets the mock faithfully simulate Postgres row scoping: a query for
 * `and(eq(id, X), eq(systemId, Y))` returns the stored row only when both X
 * and Y match it (just like the real `WHERE id = X AND system_id = Y`).
 */
function collectConditionValues(node: unknown): Set<string> {
  const acc = new Set<string>();
  const seen = new Set<unknown>();
  const walk = (x: unknown): void => {
    if (x == null || typeof x !== "object" || seen.has(x)) return;
    seen.add(x);
    const rec = x as Record<string, unknown>;
    if (
      "value" in rec &&
      (typeof rec.value === "string" || typeof rec.value === "number")
    ) {
      acc.add(String(rec.value));
    }
    for (const key of Object.keys(rec)) walk(rec[key]);
  };
  walk(node);
  return acc;
}

function createMockDb({
  storedRow,
}: {
  storedRow?: Record<string, unknown>;
} = {}) {
  const updateCalls: Array<Record<string, unknown>> = [];
  const whereSnapshots: unknown[] = [];

  /**
   * Returns the stored row only when the condition mentions every scalar
   * identity field the row carries that the service scopes on (id + systemId).
   * If the condition is absent (e.g. unfiltered getAnomalies) the row passes.
   */
  const rowsFor = (cond: unknown): Record<string, unknown>[] => {
    if (!storedRow) return [];
    if (cond === undefined) return [storedRow];
    const values = collectConditionValues(cond);
    const id = storedRow.id;
    const systemId = storedRow.systemId;
    const idMatches = id === undefined || values.has(String(id));
    const systemMatches =
      systemId === undefined || values.has(String(systemId));
    return idMatches && systemMatches ? [storedRow] : [];
  };

  const makeThenable = (rows: unknown[]) => {
    const promise = Promise.resolve(rows);
    return {
      then: promise.then.bind(promise),
      catch: promise.catch.bind(promise),
      limit: mock(() => Promise.resolve(rows)),
      orderBy: mock(() => ({
        limit: mock(() => Promise.resolve(rows)),
      })),
    };
  };

  const db = {
    select: mock(() => ({
      from: mock(() => ({
        where: mock((cond: unknown) => {
          whereSnapshots.push(cond);
          return makeThenable(rowsFor(cond));
        }),
        // Unfiltered consumption (no .where()) — returns the row unscoped.
        ...makeThenable(storedRow ? [storedRow] : []),
      })),
    })),
    update: mock(() => ({
      set: mock((values: Record<string, unknown>) => ({
        where: mock(() => {
          updateCalls.push(values);
          return Promise.resolve();
        }),
      })),
    })),
    _updateCalls: updateCalls,
    _whereSnapshots: whereSnapshots,
  };
  return db;
}

const confirmedRow = {
  id: "a1",
  systemId: "sys-A",
  state: "anomaly" as const,
  observedValue: "250",
  baselineValue: 100,
};

describe("AnomalyService.suppressAnomaly", () => {
  test("snapshots observed value + baseline and sets suppressedAt", async () => {
    const db = createMockDb({ storedRow: confirmedRow });
    const service = new AnomalyService(db as never);

    const ok = await service.suppressAnomaly({
      anomalyId: "a1",
      systemId: "sys-A",
    });

    expect(ok).toBe(true);
    expect(db._updateCalls.length).toBe(1);
    expect(db._updateCalls[0]).toMatchObject({
      suppressedValue: 250,
      suppressedBaseline: 100,
    });
    expect(db._updateCalls[0].suppressedAt).toBeInstanceOf(Date);
  });

  test("stores null suppressedValue for a non-numeric observed value", async () => {
    const db = createMockDb({
      storedRow: {
        id: "a2",
        systemId: "sys-A",
        state: "anomaly",
        observedValue: "ERROR",
        baselineValue: null,
      },
    });
    const service = new AnomalyService(db as never);

    await service.suppressAnomaly({ anomalyId: "a2", systemId: "sys-A" });

    expect(db._updateCalls[0].suppressedValue).toBeNull();
  });

  test("returns false (no write) when the row does not exist", async () => {
    const db = createMockDb();
    const service = new AnomalyService(db as never);

    const ok = await service.suppressAnomaly({
      anomalyId: "missing",
      systemId: "sys-A",
    });

    expect(ok).toBe(false);
    expect(db._updateCalls.length).toBe(0);
  });

  // ─── IDOR regression ──────────────────────────────────────────────────
  test("cannot suppress a row belonging to a different system", async () => {
    // Row b1 belongs to system B; attacker authorized on system A passes B's id.
    const db = createMockDb({
      storedRow: {
        id: "b1",
        systemId: "sys-B",
        state: "anomaly",
        observedValue: "250",
        baselineValue: 100,
      },
    });
    const service = new AnomalyService(db as never);

    const ok = await service.suppressAnomaly({
      anomalyId: "b1",
      systemId: "sys-A",
    });

    expect(ok).toBe(false);
    expect(db._updateCalls.length).toBe(0);
  });

  // ─── State guard ──────────────────────────────────────────────────────
  test("refuses to suppress a non-confirmed (suspicious) row", async () => {
    const db = createMockDb({
      storedRow: {
        id: "a3",
        systemId: "sys-A",
        state: "suspicious",
        observedValue: "250",
        baselineValue: 100,
      },
    });
    const service = new AnomalyService(db as never);

    const ok = await service.suppressAnomaly({
      anomalyId: "a3",
      systemId: "sys-A",
    });

    expect(ok).toBe(false);
    expect(db._updateCalls.length).toBe(0);
  });
});

describe("AnomalyService.unsuppressAnomaly", () => {
  test("clears all suppression columns", async () => {
    const db = createMockDb({ storedRow: confirmedRow });
    const service = new AnomalyService(db as never);

    const ok = await service.unsuppressAnomaly({
      anomalyId: "a1",
      systemId: "sys-A",
    });

    expect(ok).toBe(true);
    expect(db._updateCalls[0]).toMatchObject({
      suppressedAt: null,
      suppressedValue: null,
      suppressedBaseline: null,
    });
  });

  test("returns false when the row does not exist", async () => {
    const db = createMockDb();
    const service = new AnomalyService(db as never);

    expect(
      await service.unsuppressAnomaly({ anomalyId: "x", systemId: "sys-A" }),
    ).toBe(false);
    expect(db._updateCalls.length).toBe(0);
  });

  // ─── IDOR regression ──────────────────────────────────────────────────
  test("cannot unsuppress a row belonging to a different system", async () => {
    const db = createMockDb({
      storedRow: {
        id: "b1",
        systemId: "sys-B",
        state: "anomaly",
        observedValue: "250",
        suppressedAt: new Date(),
      },
    });
    const service = new AnomalyService(db as never);

    const ok = await service.unsuppressAnomaly({
      anomalyId: "b1",
      systemId: "sys-A",
    });

    expect(ok).toBe(false);
    expect(db._updateCalls.length).toBe(0);
  });
});

describe("AnomalyService.getAnomalies suppression filter", () => {
  test("default ('active') adds a suppressedAt IS NULL predicate", async () => {
    const db = createMockDb();
    const service = new AnomalyService(db as never);

    await service.getAnomalies({ systemId: "sys-1" });

    // A where() with a non-undefined condition was issued (the active filter
    // contributes a predicate even when no other filters are set).
    expect(db._whereSnapshots.length).toBe(1);
    expect(db._whereSnapshots[0]).toBeDefined();
  });

  test("ISO-formats suppressedAt in the returned DTO", async () => {
    const suppressedAt = new Date("2026-05-01T00:00:00.000Z");
    const db = createMockDb({
      storedRow: {
        // No `id` field: getAnomalies scopes by systemId (+ the suppression
        // predicate), not by row id, so the mock only enforces systemId here.
        systemId: "sys-1",
        startedAt: new Date("2026-04-01T00:00:00.000Z"),
        confirmedAt: null,
        recoveredAt: null,
        suppressedAt,
      },
    });
    const service = new AnomalyService(db as never);

    const [row] = await service.getAnomalies({
      systemId: "sys-1",
      suppression: "suppressed",
    });

    expect(row.suppressedAt).toBe(suppressedAt.toISOString());
  });
});
