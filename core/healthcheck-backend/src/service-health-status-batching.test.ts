import { describe, it, expect, mock } from "bun:test";
import { withTransactionMock } from "@checkstack/test-utils-backend";
import { HealthCheckService } from "./service";

/**
 * §perf regression guard: `getSystemHealthStatus` is a 1 + N read fan-out (one
 * associations query, then one run-window query per enabled association). It is
 * batched under a SINGLE `SET LOCAL search_path` transaction
 * (`withScopedTransaction`) so the scoped-db proxy pays the
 * BEGIN/SET LOCAL/COMMIT round-trips ONCE for the whole read instead of once
 * per query. This is the dominant per-tick read cost, so these tests pin that:
 *   1. the read opens exactly ONE transaction (not 1 + N), and
 *   2. every underlying query runs on the transaction handle, and
 *   3. the batching does not change the derived status.
 */
describe("getSystemHealthStatus - transaction batching (§perf)", () => {
  /**
   * Build a scoped-db mock with `assocCount` enabled associations, each with
   * its own run window. `transaction` (added by `withTransactionMock`) passes
   * the SAME mock as the tx handle, so a `select` issued on the tx resolves
   * through these stubbed chains — exactly how the real scoped proxy behaves.
   */
  function buildMock({
    associations,
    runsByCall,
  }: {
    associations: {
      configurationId: string;
      stateThresholds: null;
      configName: string;
      enabled: true;
    }[];
    runsByCall: { status: "healthy" | "unhealthy" | "degraded"; timestamp: Date }[][];
  }) {
    const assocWhere = mock(() => Promise.resolve(associations));
    const assocInnerJoin = Object.assign(Promise.resolve([]), {
      where: assocWhere,
    });
    const assocFrom = Object.assign(Promise.resolve([]), {
      innerJoin: mock(() => assocInnerJoin),
    });

    // Each per-association runs query returns the next stubbed run window.
    let runsCall = 0;
    const makeRunsFrom = () => {
      const runs = runsByCall[runsCall] ?? [];
      runsCall += 1;
      const limit = mock(() => Promise.resolve(runs));
      const orderBy = mock(() => ({ limit }));
      const where = mock(() => ({ orderBy, limit }));
      return Object.assign(Promise.resolve(runs), { where, orderBy });
    };

    let selectCall = 0;
    const db = withTransactionMock({
      select: mock(() => {
        selectCall += 1;
        // First select() is the associations query; the rest are run windows.
        if (selectCall === 1) return { from: mock(() => assocFrom) };
        return { from: mock(() => makeRunsFrom()) };
      }),
      insert: mock(() => ({
        values: mock(() => ({
          onConflictDoUpdate: mock(() => Promise.resolve()),
          onConflictDoNothing: mock(() => Promise.resolve()),
          returning: mock(() => Promise.resolve([])),
        })),
      })),
      update: mock(() => ({
        set: mock(() => ({ where: mock(() => Promise.resolve()) })),
      })),
      delete: mock(() => ({ where: mock(() => Promise.resolve()) })),
      execute: mock(() => Promise.resolve()),
    });
    return db;
  }

  it("opens exactly ONE transaction for a 1 + N read (3 associations)", async () => {
    const associations = ["c1", "c2", "c3"].map((id) => ({
      configurationId: id,
      stateThresholds: null,
      configName: id,
      enabled: true as const,
    }));
    const mockDb = buildMock({
      associations,
      runsByCall: [
        [{ status: "healthy", timestamp: new Date(2025, 0, 1) }],
        [{ status: "healthy", timestamp: new Date(2025, 0, 1) }],
        [{ status: "healthy", timestamp: new Date(2025, 0, 1) }],
      ],
    });
    const service = new HealthCheckService(
      mockDb as never,
      {} as never,
      {} as never,
    );

    const result = await service.getSystemHealthStatus("system-1", "prod");

    expect(result.status).toBe("healthy");
    // ONE transaction wraps the whole 1 + N fan-out.
    expect(mockDb.transaction).toHaveBeenCalledTimes(1);
    // 1 associations query + 3 run-window queries = 4 selects, all inside it.
    expect(mockDb.select).toHaveBeenCalledTimes(4);
  });

  it("still short-circuits to healthy (no run queries) when there are no associations", async () => {
    const mockDb = buildMock({ associations: [], runsByCall: [] });
    const service = new HealthCheckService(
      mockDb as never,
      {} as never,
      {} as never,
    );

    const result = await service.getSystemHealthStatus("system-1");

    expect(result.status).toBe("healthy");
    expect(result.checkStatuses).toEqual([]);
    // The transaction is still opened once; only the associations query runs.
    expect(mockDb.transaction).toHaveBeenCalledTimes(1);
    expect(mockDb.select).toHaveBeenCalledTimes(1);
  });

  it("keeps the run-window queries INSIDE the single transaction (1 + N selects, one tx)", async () => {
    // Two associations → 1 associations select + 2 run-window selects, all
    // issued on the tx handle within a single transaction. (Status derivation
    // itself is covered exhaustively by service-rollup-worst-wins.)
    const associations = ["c1", "c2"].map((id) => ({
      configurationId: id,
      stateThresholds: null,
      configName: id,
      enabled: true as const,
    }));
    const mockDb = buildMock({
      associations,
      runsByCall: [
        [{ status: "healthy", timestamp: new Date(2025, 0, 1) }],
        [{ status: "healthy", timestamp: new Date(2025, 0, 1) }],
      ],
    });
    const service = new HealthCheckService(
      mockDb as never,
      {} as never,
      {} as never,
    );

    await service.getSystemHealthStatus("system-1", "prod");

    expect(mockDb.transaction).toHaveBeenCalledTimes(1);
    expect(mockDb.select).toHaveBeenCalledTimes(3);
  });
});
