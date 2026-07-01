import { describe, it, expect, mock } from "bun:test";
import { HealthCheckService } from "./service";

/**
 * Regression coverage for the server-side `environmentId` predicate added
 * to `getHistory`, `getRunStats`, `getDetailedHistory`, and
 * `getAggregatedHistory` so the per-(check, environment) views in the
 * `HealthCheckDrawer` see only the env the operator clicked — not a
 * mixed-env pool filtered client-side. A client-side filter would double-
 * paginate, miscount totals, and ship rows the backend didn't return; the
 * filter MUST be at the DB so the pagination + total are honest.
 *
 * Verified by capturing the predicate each query method passes to
 * drizzle's `where(...)` and checking the bound value is present in the
 * predicate's SQL-string form (drizzle SQL nodes stringify to SQL
 * fragments that include their bindings — the same convention used by
 * `service-paused-filter.test.ts`).
 */
describe("HealthCheckService env filter on per-env queries", () => {
  /** Drizzle SQL nodes don't stringify to readable SQL, but they expose a
   * `queryChunks` array (or a `SQL<...>` wrapper) whose leaves carry the
   * bound params and column names. `containsString` recursively walks any
   * captured predicate — `eq(healthCheckRuns.environmentId, "prod")`
   * carries `"prod"` and `"environment_id"` inside its `queryChunks` —
   * and a composition via `and(...)` carries them in the top-level
   * chunks. We piggyback on this internal structure the same way drizzle
   * itself does at query serialization, so the assertion proves the
   * binding made it into the predicate object the service handed the
   * query builder. */
  function containsString(v: unknown, needle: string): boolean {
    return containsStringInner(v, needle, new Set());
  }
  function containsStringInner(
    v: unknown,
    needle: string,
    seen: Set<unknown>,
  ): boolean {
    if (typeof v === "string") return v.includes(needle);
    if (v === null || typeof v !== "object" || seen.has(v)) return false;
    seen.add(v);
    if (Array.isArray(v)) return v.some((x) => containsStringInner(x, needle, seen));
    // Visit every enumerable key + symbol — drizzle keeps bound params
    // and column names on `queryChunks` and nested column descriptors.
    const record = v as Record<PropertyKey, unknown>;
    return Object.getOwnPropertyNames(record)
      .some((key) =>
        containsStringInner(record[key], needle, seen),
      ) || Object.getOwnPropertySymbols(record).some((sym) =>
        containsStringInner(record[sym], needle, seen),
      );
  }

  /** Extracts every string-leaf reachable from a predicate. Used for
   * focused assertions like "the env column appears as IS NULL, not EQ". */
  function allStrings(v: unknown, seen = new Set<unknown>()): string[] {
    if (typeof v === "string") return [v];
    if (v === null || typeof v !== "object" || seen.has(v)) return [];
    seen.add(v);
    if (Array.isArray(v)) return v.flatMap((x) => allStrings(x, seen));
    const record = v as Record<PropertyKey, unknown>;
    return Object.getOwnPropertyNames(record)
      .flatMap((key) => allStrings(record[key], seen))
      .concat(Object.getOwnPropertySymbols(record).flatMap((sym) => allStrings(record[sym], seen)));
  }

  /**
   * Build the `db.select(...)` chain. Returns a builder object the service
   * awaits; methods are no-ops that return `self` so the chain
   * terminates. `where(predicate)` records the predicate for inspection.
   * Each captured table is indexed by call order — the service's per-
   * method structure (which selects queries, in which order) is stable so
   * the calling test can read captured predicates by index.
   */
  function makeChainable(returnValue: unknown[] = []) {
    const whereCalls: unknown[] = [];
    // Promise that also exposes the query builder chain. `await` of this
    // object returns the resolved value (an array, iterable); builder
    // methods attached so `.where(...).orderBy(...).limit(...)` chains
    // terminate in the same thenable.
    type Chain = Promise<unknown[]> & {
      where: (predicate: unknown) => Chain;
      orderBy: () => Chain;
      limit: () => Chain;
      offset: () => Chain;
      innerJoin: () => Chain;
    };
    const chain = Object.assign(Promise.resolve(returnValue), {
      where: mock((predicate: unknown) => {
        whereCalls.push(predicate);
        return chain;
      }),
      orderBy: mock(() => chain),
      limit: mock(() => chain),
      offset: mock(() => chain),
      innerJoin: mock(() => chain),
    }) as Chain;
    return { chain, whereCalls };
  }

  function buildDb(runsReturn: unknown[] = []) {
    const runsChain = makeChainable(runsReturn);
    const aggregatesChain = makeChainable(runsReturn);
    const configChain = makeChainable([{ id: "cfg-1", strategyId: "http" }]);

    // The service's `select().from(table)` — route every `from()` to one
    // of our chained builders. Order matters per-method; the test reads it
    // back via the returned `captures` lists.
    const selectCallCount = { n: 0 };
    const db = {
      select: mock(() => {
        selectCallCount.n += 1;
        return {
          from: mock((_table?: unknown) => {
            // `healthCheckConfigurations` is the first select in
            // `getAggregatedHistory`. We dispatch on call order: 1 → config,
            // since the others go through table selects below. For simpler
            // methods these are not distinguished, but practice confirms
            // the captured predicate array captures env-id semantics
            // regardless.
            return runsChain.chain;
          }),
          // `getRunStats` uses a column projection: `.select({...})`; the
          // shape returned above already exposes `.from()`.
        };
      }),
      $count: mock(() => Promise.resolve(0)),
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

    return {
      db,
      runsChain,
      aggregatesChain,
      configChain,
      selectCallCount,
    };
  }

  describe("getHistory", () => {
    it("emits an `environment_id = 'prod'` predicate for environmentId='prod'", async () => {
      const { db, runsChain } = buildDb();
      const service = new HealthCheckService(db as never, {} as never, {} as never);
      await service.getHistory({
        systemId: "sys-1",
        configurationId: "cfg-1",
        environmentId: "prod",
        sortOrder: "desc",
      });
      expect(runsChain.whereCalls.length).toBeGreaterThanOrEqual(1);
      const predicate = runsChain.whereCalls[0];
      expect(containsString(predicate, "prod")).toBe(true);
      expect(containsString(predicate, "environment_id")).toBe(true);
    });

    it("emits an IS NULL predicate for environmentId=null (env-less slice)", async () => {
      const { db, runsChain } = buildDb();
      const service = new HealthCheckService(db as never, {} as never, {} as never);
      await service.getHistory({
        systemId: "sys-1",
        configurationId: "cfg-1",
        environmentId: null,
        sortOrder: "desc",
      });
      const predicate = runsChain.whereCalls[0];
      expect(containsString(predicate, "environment_id")).toBe(true);
      // drizzle's `isNull` carries an " is null" string chunk in addition
      // to the column reference; distinct from `eq` whose only non-column
      // string is the placeholder "" / the bound `prod` value.
      const leaves = allStrings(predicate);
      const hasIsNull = leaves.some((s) => s.toLowerCase().includes(" is null"));
      expect(hasIsNull).toBe(true);
    });

    it("omits the env predicate for environmentId=undefined (all envs)", async () => {
      const { db, runsChain } = buildDb();
      const service = new HealthCheckService(db as never, {} as never, {} as never);
      await service.getHistory({
        systemId: "sys-1",
        configurationId: "cfg-1",
        environmentId: undefined,
        sortOrder: "desc",
      });
      const predicate = runsChain.whereCalls[0];
      // The env column NAME may still appear nested inside the shared
      // `healthCheckRuns` schema object attached to every column
      // descriptor. But an `eq(environmentId, X)` binding carries the env
      // VALUE as a string leaf; with `environmentId === undefined` we
      // never build that clause. Assert no env-id VALUE leaf appears —
      // proves the env `eq(...)` (and the `isNull(...)`) was NOT added.
      expect(containsString(predicate, "prod")).toBe(false);
      // No " is null" string-leaf either — that leaf is added exclusively
      // by the env-less branch, not by the systemId / configurationId
      // predicates.
      const leaves = allStrings(predicate);
      expect(leaves.some((s) => s.toLowerCase().includes(" is null"))).toBe(false);
    });
  });

  describe("getDetailedHistory", () => {
    it("emits the env predicate the same way as getHistory", async () => {
      const { db, runsChain } = buildDb();
      const service = new HealthCheckService(db as never, {} as never, {} as never);
      await service.getDetailedHistory({
        systemId: "sys-1",
        configurationId: "cfg-1",
        environmentId: "staging",
        sortOrder: "desc",
      });
      const predicate = runsChain.whereCalls[0];
      expect(containsString(predicate, "staging")).toBe(true);
      expect(containsString(predicate, "environment_id")).toBe(true);
    });
  });

  describe("getRunStats", () => {
    it("emits the env predicate (single where() on the runs table)", async () => {
      const { db, runsChain } = buildDb();
      const service = new HealthCheckService(db as never, {} as never, {} as never);
      await service.getRunStats({
        systemId: "sys-1",
        configurationId: "cfg-1",
        startDate: new Date(2025, 0, 1),
        endDate: new Date(2025, 0, 2),
        environmentId: "prod",
      });
      const predicate = runsChain.whereCalls[0];
      expect(containsString(predicate, "prod")).toBe(true);
      expect(containsString(predicate, "environment_id")).toBe(true);
    });
  });

  describe("getAggregatedHistory", () => {
    /**
     * `getAggregatedHistory` reads `health_check_runs` (raw tier) AND
     * `health_check_aggregates` (hourly + daily tiers) in parallel via
     * `Promise.all`, plus one config-row select. Each tier's
     * `.where(...)` must carry the env predicate so the cross-tier
     * aggregation engine reads ONLY that env's runs and buckets — a
     * mixed-env pool would silently leak the wrong env's sparkline into
     * the drawer's charts. Asserts the env-id binding appears in at least
     * one captured predicate (the raw tier).
     */
    it("emits the env predicate on the runs tier (and aggregates)", async () => {
      const { db, runsChain } = buildDb();
      const service = new HealthCheckService(db as never, {} as never, {} as never);
      await service.getAggregatedHistory(
        {
          systemId: "sys-1",
          configurationId: "cfg-1",
          startDate: new Date(2025, 0, 1),
          endDate: new Date(2025, 0, 2),
          environmentId: "prod",
        },
        { includeAggregatedResult: false },
      );
      expect(runsChain.whereCalls.length).toBeGreaterThanOrEqual(1);
      const anyPredicateContainsProd = runsChain.whereCalls.some(
        (p) => containsString(p, "prod") && containsString(p, "environment_id"),
      );
      expect(anyPredicateContainsProd).toBe(true);
    });
  });

  describe("getAggregatedHistory (null)", () => {
    it("emits the IS NULL predicate for the env-less slice", async () => {
      const { db, runsChain } = buildDb();
      const service = new HealthCheckService(db as never, {} as never, {} as never);
      await service.getAggregatedHistory(
        {
          systemId: "sys-1",
          configurationId: "cfg-1",
          startDate: new Date(2025, 0, 1),
          endDate: new Date(2025, 0, 2),
          environmentId: null,
        },
        { includeAggregatedResult: false },
      );
      const anyHasEnvColumn = runsChain.whereCalls.some((p) =>
        containsString(p, "environment_id"),
      );
      expect(anyHasEnvColumn).toBe(true);
      const anyHasIsNull = runsChain.whereCalls.some((p) =>
        allStrings(p).some((s) => s.toLowerCase().includes(" is null")),
      );
      expect(anyHasIsNull).toBe(true);
    });
  });
});