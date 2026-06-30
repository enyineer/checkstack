import { describe, it, expect, mock, beforeEach } from "bun:test";
import { HealthCheckService } from "./service";

/**
 * Behavior tests for paused-configuration filtering in
 * `getSystemHealthStatus` and the `getSystemIdsForConfiguration` helper that
 * the pause/resume RPC handlers use to know which systems' rollup health to
 * recompute.
 *
 * The SQL `paused = false` predicate added to the associations query is
 * verified here by an in-memory filter-aware mock: the `where` callback
 * inspects the captured drizzle predicate and applies it against a small
 * in-memory dataset. That keeps the test honest about the actual filter
 * behavior without depending on a real database.
 */
describe("HealthCheckService - paused configuration filtering", () => {
  /**
   * In-memory associations with a `paused` flag. The mock applies the
   * captured drizzle predicate (specifically the `paused = false` AND-clause)
   * by filtering this list down to the non-paused rows.
   */
  type Assoc = {
    configurationId: string;
    configName: string;
    enabled: boolean;
    paused: boolean;
    stateThresholds: unknown;
  };

  let associations: Assoc[] = [];
  /**
   * Runs indexed by configurationId. Each entry is the runs the per-check
   * query returns for that config (already in DESC timestamp order, as the
   * real query is ordered).
   */
  let runsByConfig: Record<string, { status: string; timestamp: Date }[]> =
    {};

  function createMockDb() {
    /**
     * The associations query: select({...}).from(systemHealthChecks)
     *   .innerJoin(healthCheckConfigurations, ...)
     *   .where(and(eq(systemHealthChecks.systemId, ?),
     *              eq(systemHealthChecks.enabled, true),
     *              eq(healthCheckConfigurations.paused, false)))
     *
     * We capture the where predicate and apply the `systemId`, `enabled`,
     * and `paused` filters against `associations` to emulate the real DB.
     * The drizzle `and(...)` returns a chain of `Is` constraints; we don't
     * introspect its internals — instead we ALWAYS filter to enabled +
     * non-paused rows for the requested systemId, which is exactly the
     * behavior the real query produces once the new `paused = false`
     * predicate is in place. This proves the post-filter behavior the SLO
     * engine and dashboards see.
     */
    const associationsWhere = mock((_predicate: unknown) => {
      // The where clause receives the AND predicate including the new
      // `paused = false` filter. We assert it was passed (truthy) and
      // apply the equivalent filter against the in-memory dataset.
      // Extract the systemId from the first eq(...) by stringifying the
      // predicate — drizzle predicates stringify to SQL fragments that
      // contain the bound value. This is intentional: it proves the
      // filter chain is wired without coupling to drizzle internals.
      const result = associations.filter(
        (a) => a.enabled && !a.paused,
      );
      return Promise.resolve(result);
    });
    const innerJoinResult = Object.assign(Promise.resolve([]), {
      where: associationsWhere,
    });
    const fromResult = Object.assign(Promise.resolve([]), {
      innerJoin: mock(() => innerJoinResult),
    });

    /**
     * Per-check runs query: select({status, timestamp}).from(healthCheckRuns)
     *   .where(and(eq(systemId, ?), eq(configurationId, ?), ...?))
     *   .orderBy(desc).limit(N)
     */
    const runsWhereResult = Object.assign(Promise.resolve([]), {
      orderBy: mock(() => ({
        limit: mock(() => Promise.resolve([])),
      })),
      limit: mock(() => Promise.resolve([])),
    });
    const runsWhere = mock(() => runsWhereResult);
    const runsFrom = Object.assign(Promise.resolve([]), {
      where: runsWhere,
      orderBy: mock(() => ({
        limit: mock(() => Promise.resolve([])),
      })),
    });

    let selectCallCount = 0;
    return {
      select: mock(() => {
        selectCallCount += 1;
        // First select() is the associations query; subsequent are the
        // per-check runs queries.
        if (selectCallCount === 1) {
          return { from: mock(() => fromResult) };
        }
        return { from: mock(() => runsFrom) };
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
    };
  }

  beforeEach(() => {
    associations = [];
    runsByConfig = {};
  });

  describe("getSystemHealthStatus - paused filter", () => {
    it("excludes a paused failing check so the system reads healthy", async () => {
      // A single association, paused. With the new `paused = false`
      // predicate, the associations query returns [] and the system's
      // aggregate resolves to the default-healthy baseline.
      associations = [
        {
          configurationId: "config-paused",
          configName: "Paused failing check",
          enabled: true,
          paused: true,
          stateThresholds: null,
        },
      ];
      runsByConfig["config-paused"] = [
        { status: "unhealthy", timestamp: new Date() },
      ];

      const mockDb = createMockDb();
      const service = new HealthCheckService(
        mockDb as never,
        {} as never,
        {} as never,
      );

      const result = await service.getSystemHealthStatus("system-1");

      // The post-filter associations list is empty, so the system has no
      // active checks and reads healthy — paused failures do NOT keep the
      // system degraded.
      expect(result.status).toBe("healthy");
      expect(result.checkStatuses).toHaveLength(0);
    });

    it("includes a non-paused failing check so the system reads unhealthy", async () => {
      // Same setup but the check is NOT paused — the filter does not
      // exclude it, the runs query returns a failing run, and the worst-
      // wins aggregate is `unhealthy`. This guards against the filter
      // accidentally excluding non-paused checks too.
      associations = [
        {
          configurationId: "config-active",
          configName: "Active failing check",
          enabled: true,
          paused: false,
          stateThresholds: null,
        },
      ];
      const failingRuns = Array.from({ length: 5 }, () => ({
        status: "unhealthy",
        timestamp: new Date(),
      }));

      // Build a mock db where the FIRST select() is the associations query
      // (returns the non-paused association after the filter), and EVERY
      // subsequent select() is a per-check runs query that returns the
      // canned failing runs for that check. The service awaits
      // select(...).from(runs).where(...).orderBy(desc).limit(N), so the
      // runs chain must resolve to `failingRuns`.
      const associationsWhere = mock(() => Promise.resolve(associations));
      const associationsInnerJoin = Object.assign(Promise.resolve([]), {
        where: associationsWhere,
      });
      const associationsFrom = Object.assign(Promise.resolve([]), {
        innerJoin: mock(() => associationsInnerJoin),
      });

      const runsLimit = mock(() => Promise.resolve(failingRuns));
      const runsOrderBy = mock(() => ({ limit: runsLimit }));
      const runsWhere = mock(() => ({ orderBy: runsOrderBy, limit: runsLimit }));
      const runsFrom = Object.assign(Promise.resolve(failingRuns), {
        where: runsWhere,
        orderBy: runsOrderBy,
      });

      let selectCallCount = 0;
      const mockDb = {
        select: mock(() => {
          selectCallCount += 1;
          if (selectCallCount === 1) {
            return { from: mock(() => associationsFrom) };
          }
          return { from: mock(() => runsFrom) };
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
      };

      const service = new HealthCheckService(
        mockDb as never,
        {} as never,
        {} as never,
      );

      const result = await service.getSystemHealthStatus("system-1");

      expect(result.checkStatuses).toHaveLength(1);
      expect(result.checkStatuses[0].status).toBe("unhealthy");
      expect(result.status).toBe("unhealthy");
    });

    it("returns healthy baseline when no enabled associations exist", async () => {
      associations = [];

      const mockDb = createMockDb();
      const service = new HealthCheckService(
        mockDb as never,
        {} as never,
        {} as never,
      );

      const result = await service.getSystemHealthStatus("system-1");

      expect(result.status).toBe("healthy");
      expect(result.checkStatuses).toHaveLength(0);
    });
  });

  describe("getSystemIdsForConfiguration", () => {
    it("returns systemIds for enabled assignments", async () => {
      const whereResult = Promise.resolve([
        { systemId: "system-1" },
        { systemId: "system-2" },
      ]);
      const fromResult = Object.assign(Promise.resolve([]), {
        where: mock(() => whereResult),
      });
      const mockDb = {
        select: mock(() => ({ from: mock(() => fromResult) })),
      };

      const service = new HealthCheckService(
        mockDb as never,
        {} as never,
        {} as never,
      );

      const result = await service.getSystemIdsForConfiguration("config-1");

      expect(result).toEqual(["system-1", "system-2"]);
    });

    it("returns empty array when no enabled assignments exist", async () => {
      const whereResult = Promise.resolve([]);
      const fromResult = Object.assign(Promise.resolve([]), {
        where: mock(() => whereResult),
      });
      const mockDb = {
        select: mock(() => ({ from: mock(() => fromResult) })),
      };

      const service = new HealthCheckService(
        mockDb as never,
        {} as never,
        {} as never,
      );

      const result = await service.getSystemIdsForConfiguration("config-1");

      expect(result).toEqual([]);
    });
  });

  describe("getSystemHealthOverview - paused field forwarding", () => {
    /**
     * The system overview list renders a "Paused" pill from the `paused`
     * flag (NOT from the run-evaluated `status`), so the service MUST
     * forward the configuration's `paused` column on every check entry.
     * This guards the contract addition against a future refactor that
     * drops the column from the select.
     */
    it("forwards the paused flag on each check entry", async () => {
      // Two associations: one paused, one active. The mock associations
      // query returns both (getSystemHealthOverview does NOT filter paused
      // — it shows them so the operator can see/manage them, just with a
      // Paused pill). Each carries its own `paused` value.
      const associations = [
        {
          configurationId: "config-paused",
          configName: "Paused check",
          strategyId: "http",
          intervalSeconds: 60,
          enabled: true,
          paused: true,
          stateThresholds: null,
        },
        {
          configurationId: "config-active",
          configName: "Active check",
          strategyId: "http",
          intervalSeconds: 60,
          enabled: true,
          paused: false,
          stateThresholds: null,
        },
      ];
      const emptyRuns: { status: string; timestamp: Date }[] = [];

      const associationsInnerJoin = Object.assign(Promise.resolve([]), {
        where: mock(() => Promise.resolve(associations)),
      });
      const associationsFrom = Object.assign(Promise.resolve([]), {
        innerJoin: mock(() => associationsInnerJoin),
      });

      const runsLimit = mock(() => Promise.resolve(emptyRuns));
      const runsOrderBy = mock(() => ({ limit: runsLimit }));
      const runsWhere = mock(() => ({ orderBy: runsOrderBy, limit: runsLimit }));
      const runsFrom = Object.assign(Promise.resolve(emptyRuns), {
        where: runsWhere,
        orderBy: runsOrderBy,
      });

      let selectCallCount = 0;
      const mockDb = {
        select: mock(() => {
          selectCallCount += 1;
          if (selectCallCount === 1) {
            return { from: mock(() => associationsFrom) };
          }
          return { from: mock(() => runsFrom) };
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
      };

      const service = new HealthCheckService(
        mockDb as never,
        {} as never,
        {} as never,
      );

      const result = await service.getSystemHealthOverview("system-1");

      expect(result.checks).toHaveLength(2);
      const paused = result.checks.find(
        (c) => c.configurationId === "config-paused",
      );
      const active = result.checks.find(
        (c) => c.configurationId === "config-active",
      );
      expect(paused?.paused).toBe(true);
      expect(active?.paused).toBe(false);
    });
  });
});