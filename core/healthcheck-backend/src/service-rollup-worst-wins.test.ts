import { describe, it, expect, mock } from "bun:test";
import { HealthCheckService } from "./service";
import { evaluateHealthStatus } from "./state-evaluator";

/**
 * Regression coverage for the system-rollup worst-wins-across-environments
 * fix in `getSystemHealthStatus(systemId)` (the `environmentId === undefined`
 * branch).
 *
 * The original branch flattened every environment's runs into one
 * `timestamp DESC` list and handed the interleaved list to the threshold
 * evaluator (the default `consecutive` mode). Consecutive mode walks
 * newest-first and breaks the streak on the first interleaving env, so the
 * rollup collapsed to whichever env ran last in the batch — masking any
 * permanently-failing sibling env ("the healthy env wins" / latest-wins)
 * and flapping whenever env insertion order drifted across ticks.
 *
 * The fix evaluates the threshold window PER ENVIRONMENT within the
 * association and takes worst-wins across envs (unhealthy > degraded >
 * healthy), making the rollup stable regardless of insertion order or
 * multi-pod racing. These tests pin that behavior with a mocked DB that
 * returns the interleaved mixed-pool the real query would surface.
 */
describe("HealthCheckService - system rollup worst-wins across environments", () => {
  /**
   * The mixed-pool query captured by the mock. Ordered DESC (newest first),
   * exactly the shape the real `health_check_runs` query returns. Two envs
   * (`prod`, `staging`) of one assignment, both fanning out every tick, prod
   * permanently unhealthy and staging permanently healthy. The env insertion
   * order in the executor is sequential membership order, so prod lands before
   * staging, making the latest run in the pool a staging-healthy run — the
   * exact scenario that masked prod's outage under flattening.
   */
  const PROD_RUN = { status: "unhealthy" as const, environmentId: "prod" };
  const STAGE_RUN = { status: "healthy" as const, environmentId: "staging" };

  function buildMixedPool(ticksPerEnv = 5): { status: "unhealthy" | "healthy"; timestamp: Date; environmentId: string }[] {
    const pool: { status: "unhealthy" | "healthy"; timestamp: Date; environmentId: string }[] = [];
    for (let i = 0; i < ticksPerEnv; i++) {
      pool.push({ ...PROD_RUN, timestamp: new Date(2025, 0, 1, 0, 0, i) });
      pool.push({ ...STAGE_RUN, timestamp: new Date(2025, 0, 1, 0, 0, i + 0.5) });
    }
    return pool; // DESC at the DB layer; we return newest-first below.
  }

  function createMockDb(runsMixedDesc: { status: string; timestamp: Date; environmentId: string }[]) {
    const assocWhere = mock(() => Promise.resolve([
      {
        configurationId: "config-1",
        configName: "HTTP probe",
        enabled: true,
        paused: false,
        stateThresholds: null,
      },
    ]));
    const assocInnerJoin = Object.assign(Promise.resolve([]), { where: assocWhere });
    const assocFrom = Object.assign(Promise.resolve([]), { innerJoin: mock(() => assocInnerJoin) });

    const runsLimit = mock(() => Promise.resolve(runsMixedDesc));
    const runsOrderBy = mock(() => ({ limit: runsLimit }));
    const runsWhere = mock(() => ({ orderBy: runsOrderBy, limit: runsLimit }));
    const runsFrom = Object.assign(Promise.resolve(runsMixedDesc), {
      where: runsWhere,
      orderBy: runsOrderBy,
    });

    let selectCallCount = 0;
    return {
      select: mock(() => {
        selectCallCount += 1;
        if (selectCallCount === 1) return { from: mock(() => assocFrom) };
        return { from: mock(() => runsFrom) };
      }),
      insert: mock(() => ({
        values: mock(() => ({
          onConflictDoUpdate: mock(() => Promise.resolve()),
          onConflictDoNothing: mock(() => Promise.resolve()),
          returning: mock(() => Promise.resolve([])),
        })),
      })),
      update: mock(() => ({ set: mock(() => ({ where: mock(() => Promise.resolve()) })) })),
      delete: mock(() => ({ where: mock(() => Promise.resolve()) })),
      execute: mock(() => Promise.resolve()),
    };
  }

  it("the rollup reports unhealthy when ONE env is permanently unhealthy, the other healthy", async () => {
    // DB returns newest-first interleaved runs. The pre-fix behavior would
    // mask prod's outage because the latest run is staging-healthy; the
    // threshold evaluator (default consecutive mode) walks newest-first from
    // staging-healthy, breaks the streak on the very next prod-unhealthy run,
    // and falls back to `"healthy"`.
    const pool = buildMixedPool(5);
    const runsDesc = pool.toReversed(); // oldest produced first above; reverse to DESC
    const mockDb = createMockDb(runsDesc as never);
    const service = new HealthCheckService(mockDb as never, {} as never, {} as never);

    const result = await service.getSystemHealthStatus("system-1");

    expect(result.status).toBe("unhealthy");
    expect(result.checkStatuses).toHaveLength(1);
    expect(result.checkStatuses[0].status).toBe("unhealthy");
    expect(result.checkStatuses[0].runsConsidered).toBe(pool.length);
    // Fan-out accounting: two environment slices (prod + staging), one failing.
    expect(result.checkStatuses[0].sliceCount).toBe(2);
    expect(result.checkStatuses[0].failingSliceCount).toBe(1);
  });

  it("counts every failing environment slice for the fan-out denominator (3 envs, 2 failing)", () => {
    // Three envs of one check: prod + eu unhealthy, staging healthy. The rollup
    // is unhealthy, and the fan-out accounting must report sliceCount 3 with
    // failingSliceCount 2 so the dashboard can render "2 of 3 checks failing".
    const pool: {
      status: "healthy" | "unhealthy";
      timestamp: Date;
      environmentId: string;
    }[] = [];
    for (let i = 0; i < 5; i++) {
      pool.push({ status: "unhealthy", timestamp: new Date(2025, 0, 1, 0, 0, i), environmentId: "prod" });
      pool.push({ status: "unhealthy", timestamp: new Date(2025, 0, 1, 0, 0, i, 250), environmentId: "eu" });
      pool.push({ status: "healthy", timestamp: new Date(2025, 0, 1, 0, 0, i, 500), environmentId: "staging" });
    }
    const runsDesc = pool.toReversed();
    const mockDb = createMockDb(runsDesc as never);
    const service = new HealthCheckService(mockDb as never, {} as never, {} as never);

    return service.getSystemHealthStatus("system-1").then((result) => {
      expect(result.status).toBe("unhealthy");
      expect(result.checkStatuses[0].sliceCount).toBe(3);
      expect(result.checkStatuses[0].failingSliceCount).toBe(2);
    });
  });

  it("flattening the same mixed pool through the evaluator (the pre-fix derivation) would have returned `healthy`", async () => {
    // Sanity check: the very data the rollup branch reads, fed directly to
    // `evaluateHealthStatus` as one flat interleaved list, collapses to
    // "healthy" — the precise regression this fix replaces with per-env
    // evaluation. Pinning it here guards against a relax of the test above.
    const pool = buildMixedPool(5);
    const runsDesc = pool.toReversed();
    const flatStatus = evaluateHealthStatus({
      runs: runsDesc as never,
    });
    expect(flatStatus).toBe("healthy");
  });

  it("reports healthy only when EVERY env is healthy", async () => {
    const allHealthy = Array.from({ length: 10 }, (_, i) => ({
      status: "healthy",
      timestamp: new Date(2025, 0, 1, 0, 0, i),
      environmentId: i % 2 === 0 ? "prod" : "staging",
    })).toReversed();
    const mockDb = createMockDb(allHealthy as never);
    const service = new HealthCheckService(mockDb as never, {} as never, {} as never);

    const result = await service.getSystemHealthStatus("system-1");
    expect(result.status).toBe("healthy");
  });

  it("degrades (not flaps) when one env is degraded and the other healthy", async () => {
    // Default consecutive thresholds need 2 consecutive failures to escalate
    // to `degraded` (and 5 to escalate to `unhealthy` — so keep prod's streak
    // at exactly 2 degraded runs). Per-env: prod's env-sorted slice =
    // [degraded, degraded] (newest first) → degraded; staging → healthy.
    // Rollup worst-wins = degraded. Flattening would break on the staging
    // interleave and return `healthy` (the masked bug); per-env gives a
    // stable `degraded`.
    const pool: { status: "healthy" | "degraded"; timestamp: Date; environmentId: string }[] = [];
    for (let i = 0; i < 2; i++) {
      pool.push({ status: "degraded", timestamp: new Date(2025, 0, 1, 0, 0, i), environmentId: "prod" });
      pool.push({ status: "healthy", timestamp: new Date(2025, 0, 1, 0, 0, i + 0.5), environmentId: "staging" });
    }
    const runsDesc = pool.toReversed();
    const mockDb = createMockDb(runsDesc as never);
    const service = new HealthCheckService(mockDb as never, {} as never, {} as never);

    const result = await service.getSystemHealthStatus("system-1");
    expect(result.status).toBe("degraded");
  });

  it("the per-env slice (concrete environmentId) is unaffected — only the rollup branch changed", async () => {
    // Pass an explicit environmentId; the old per-env branch (string envId)
    // must continue to filter to that env's slice. Here we ask for `prod`
    // and expect unhealthy.
    const prodOnly = Array.from({ length: 5 }, (_, i) => ({
      status: "unhealthy",
      timestamp: new Date(2025, 0, 1, 0, 0, i),
    }));
    // Mock: the runs query mirrors the predicate back to prodOnly.
    const assocWhere = mock(() => Promise.resolve([
      {
        configurationId: "config-1",
        configName: "HTTP probe",
        enabled: true,
        paused: false,
        stateThresholds: null,
      },
    ]));
    const assocInnerJoin = Object.assign(Promise.resolve([]), { where: assocWhere });
    const assocFrom = Object.assign(Promise.resolve([]), { innerJoin: mock(() => assocInnerJoin) });

    const runsLimit = mock(() => Promise.resolve(prodOnly));
    const runsOrderBy = mock(() => ({ limit: runsLimit }));
    const runsWhere = mock(() => ({ orderBy: runsOrderBy, limit: runsLimit }));
    const runsFrom = Object.assign(Promise.resolve(prodOnly), {
      where: runsWhere,
      orderBy: runsOrderBy,
    });

    let selectCallCount = 0;
    const mockDb = {
      select: mock(() => {
        selectCallCount += 1;
        if (selectCallCount === 1) return { from: mock(() => assocFrom) };
        return { from: mock(() => runsFrom) };
      }),
      insert: mock(() => ({
        values: mock(() => ({
          onConflictDoUpdate: mock(() => Promise.resolve()),
          onConflictDoNothing: mock(() => Promise.resolve()),
          returning: mock(() => Promise.resolve([])),
        })),
      })),
      update: mock(() => ({ set: mock(() => ({ where: mock(() => Promise.resolve()) })) })),
      delete: mock(() => ({ where: mock(() => Promise.resolve()) })),
      execute: mock(() => Promise.resolve()),
    };

    const service = new HealthCheckService(mockDb as never, {} as never, {} as never);
    const result = await service.getSystemHealthStatus("system-1", "prod");
    expect(result.status).toBe("unhealthy");
    // A single-env evaluation is always one slice; failing here since prod is
    // unhealthy.
    expect(result.checkStatuses[0].sliceCount).toBe(1);
    expect(result.checkStatuses[0].failingSliceCount).toBe(1);
  });
});