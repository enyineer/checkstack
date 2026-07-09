import { describe, it, expect, mock } from "bun:test";
import { withTransactionMock } from "@checkstack/test-utils-backend";
import { HealthCheckService } from "./service";
import { evaluateHealthStatus } from "./state-evaluator";

/**
 * Regression coverage for the system-rollup derivation in
 * `getSystemHealthStatus(systemId)` (the `environmentId === undefined` branch):
 *
 *  1. Worst-wins ACROSS environments within an association. The original branch
 *     flattened every environment's runs into one `timestamp DESC` list and
 *     handed the interleaved list to the threshold evaluator (default
 *     `consecutive` mode). Consecutive mode walks newest-first and breaks the
 *     streak on the first interleaving env, so the rollup collapsed to whichever
 *     env ran last — masking a permanently-failing sibling env ("the healthy env
 *     wins" / latest-wins) and flapping whenever env insertion order drifted.
 *     The fix evaluates a FULL per-env window and takes worst-wins across envs.
 *
 *  2. Currently-effective-slice filtering. A per-env slice whose environment was
 *     DISABLED for the assignment (removed from `environmentIds`) must STOP
 *     contributing immediately - its stale unhealthy runs must not keep dragging
 *     the rollup until they age out of the window.
 *
 * Each environment is now windowed by its OWN query (per-env `LIMIT`), so the
 * mock resolves each per-env runs query against the env bound in its predicate.
 */

/** Walk a drizzle predicate object and collect every bound literal value. */
function collectPredicateValues(predicate: unknown): string[] {
  const values: string[] = [];
  const seen = new Set<unknown>();
  const walk = (node: unknown) => {
    if (node == null || seen.has(node) || typeof node !== "object") return;
    seen.add(node);
    if ("value" in (node as Record<string, unknown>)) {
      const v = (node as { value: unknown }).value;
      if (typeof v === "string") values.push(v);
    }
    for (const child of Object.values(node as Record<string, unknown>)) {
      walk(child);
    }
  };
  walk(predicate);
  return values;
}

type Run = { status: "healthy" | "degraded" | "unhealthy"; timestamp: Date };

/**
 * Build a mock db for the rollup path. `runsByEnv` maps each environment key
 * (`null` = env-less) to that env's runs (DESC). `environmentIds` is the
 * assignment's selector under test. The per-env runs query resolves against the
 * concrete env id bound in its predicate (or the env-less slice when none of the
 * known env ids appear, i.e. the `isNull` clause).
 */
function createRollupMockDb(props: {
  runsByEnv: Map<string | null, Run[]>;
  environmentIds: string[] | null;
}) {
  const { runsByEnv, environmentIds } = props;
  const knownEnvIds = new Set(
    [...runsByEnv.keys()].filter((k): k is string => k !== null),
  );

  const assocWhere = mock(() =>
    Promise.resolve([
      {
        configurationId: "config-1",
        configName: "HTTP probe",
        enabled: true,
        paused: false,
        stateThresholds: null,
        environmentIds,
      },
    ]),
  );
  const assocInnerJoin = Object.assign(Promise.resolve([]), {
    where: assocWhere,
  });
  const assocFrom = Object.assign(Promise.resolve([]), {
    innerJoin: mock(() => assocInnerJoin),
  });

  // Per-env runs query: pick the slice named by the predicate's env value.
  const resolvePerEnv = (predicate: unknown): Run[] => {
    const values = collectPredicateValues(predicate);
    const envId = values.find((v) => knownEnvIds.has(v)) ?? null;
    return runsByEnv.get(envId) ?? [];
  };
  const runsFromFor = () => {
    const runsWhere = mock((predicate: unknown) => {
      const rows = resolvePerEnv(predicate);
      const limit = mock(() => Promise.resolve(rows));
      return { orderBy: mock(() => ({ limit })), limit };
    });
    return Object.assign(Promise.resolve([]), { where: runsWhere });
  };

  // Distinct env keys query: select({environmentId}).from().where().
  const distinctFrom = Object.assign(Promise.resolve([]), {
    where: mock(() =>
      Promise.resolve([...runsByEnv.keys()].map((k) => ({ environmentId: k }))),
    ),
  });

  let selectCallCount = 0;
  return withTransactionMock({
    select: mock(() => {
      selectCallCount += 1;
      // #1 associations; every subsequent select is a per-env runs window.
      if (selectCallCount === 1) return { from: mock(() => assocFrom) };
      return { from: mock(() => runsFromFor()) };
    }),
    selectDistinct: mock(() => ({ from: mock(() => distinctFrom) })),
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
}

function runs(status: Run["status"], count: number, envSecondOffset = 0): Run[] {
  return Array.from({ length: count }, (_, i) => ({
    status,
    timestamp: new Date(2025, 0, 1, 0, 0, i, envSecondOffset),
  })).toReversed(); // DESC (newest first)
}

describe("HealthCheckService - system rollup worst-wins across environments", () => {
  it("reports unhealthy when ONE env is permanently unhealthy, the other healthy", async () => {
    const runsByEnv = new Map<string | null, Run[]>([
      ["prod", runs("unhealthy", 5)],
      ["staging", runs("healthy", 5)],
    ]);
    const mockDb = createRollupMockDb({ runsByEnv, environmentIds: null });
    const service = new HealthCheckService(mockDb as never, {} as never, {} as never);

    const result = await service.getSystemHealthStatus("system-1");

    expect(result.status).toBe("unhealthy");
    expect(result.checkStatuses).toHaveLength(1);
    expect(result.checkStatuses[0].status).toBe("unhealthy");
    expect(result.checkStatuses[0].runsConsidered).toBe(10);
    // Fan-out accounting: two environment slices (prod + staging), one failing.
    expect(result.checkStatuses[0].sliceCount).toBe(2);
    expect(result.checkStatuses[0].failingSliceCount).toBe(1);
  });

  it("counts every failing environment slice for the fan-out denominator (3 envs, 2 failing)", async () => {
    const runsByEnv = new Map<string | null, Run[]>([
      ["prod", runs("unhealthy", 5)],
      ["eu", runs("unhealthy", 5)],
      ["staging", runs("healthy", 5)],
    ]);
    const mockDb = createRollupMockDb({ runsByEnv, environmentIds: null });
    const service = new HealthCheckService(mockDb as never, {} as never, {} as never);

    const result = await service.getSystemHealthStatus("system-1");
    expect(result.status).toBe("unhealthy");
    expect(result.checkStatuses[0].sliceCount).toBe(3);
    expect(result.checkStatuses[0].failingSliceCount).toBe(2);
  });

  it("flattening the same mixed pool through the evaluator (the pre-fix derivation) would have returned `healthy`", () => {
    // Sanity check: the very data the rollup branch reads, fed directly to
    // `evaluateHealthStatus` as one flat interleaved list, collapses to
    // "healthy" — the precise regression per-env evaluation replaces.
    const pool: Run[] = [];
    for (let i = 0; i < 5; i++) {
      pool.push({ status: "unhealthy", timestamp: new Date(2025, 0, 1, 0, 0, i) });
      pool.push({ status: "healthy", timestamp: new Date(2025, 0, 1, 0, 0, i, 500) });
    }
    const flatStatus = evaluateHealthStatus({ runs: pool.toReversed() as never });
    expect(flatStatus).toBe("healthy");
  });

  it("reports healthy only when EVERY env is healthy", async () => {
    const runsByEnv = new Map<string | null, Run[]>([
      ["prod", runs("healthy", 5)],
      ["staging", runs("healthy", 5)],
    ]);
    const mockDb = createRollupMockDb({ runsByEnv, environmentIds: null });
    const service = new HealthCheckService(mockDb as never, {} as never, {} as never);

    const result = await service.getSystemHealthStatus("system-1");
    expect(result.status).toBe("healthy");
  });

  it("degrades (not flaps) when one env is degraded and the other healthy", async () => {
    const runsByEnv = new Map<string | null, Run[]>([
      ["prod", runs("degraded", 2)],
      ["staging", runs("healthy", 2)],
    ]);
    const mockDb = createRollupMockDb({ runsByEnv, environmentIds: null });
    const service = new HealthCheckService(mockDb as never, {} as never, {} as never);

    const result = await service.getSystemHealthStatus("system-1");
    expect(result.status).toBe("degraded");
  });

  it("drops a DISABLED environment's stale unhealthy runs from the rollup (regression)", async () => {
    // prod was DISABLED for the assignment (environmentIds now ['staging']) but
    // its historical unhealthy runs still exist. The rollup must ignore prod and
    // read healthy from the sole effective env (staging), immediately - not after
    // prod's runs age out of the window.
    const runsByEnv = new Map<string | null, Run[]>([
      ["prod", runs("unhealthy", 5)],
      ["staging", runs("healthy", 5)],
    ]);
    const mockDb = createRollupMockDb({
      runsByEnv,
      environmentIds: ["staging"],
    });
    const service = new HealthCheckService(mockDb as never, {} as never, {} as never);

    const result = await service.getSystemHealthStatus("system-1");

    expect(result.status).toBe("healthy");
    expect(result.checkStatuses[0].status).toBe("healthy");
    // Only the effective (staging) slice counts now.
    expect(result.checkStatuses[0].sliceCount).toBe(1);
    expect(result.checkStatuses[0].failingSliceCount).toBe(0);
    expect(result.checkStatuses[0].runsConsidered).toBe(5);
  });

  it("opting out ([]) drops all concrete-env runs and keeps only the env-less slice", async () => {
    const runsByEnv = new Map<string | null, Run[]>([
      ["prod", runs("unhealthy", 5)],
      [null, runs("healthy", 3)],
    ]);
    const mockDb = createRollupMockDb({ runsByEnv, environmentIds: [] });
    const service = new HealthCheckService(mockDb as never, {} as never, {} as never);

    const result = await service.getSystemHealthStatus("system-1");
    expect(result.status).toBe("healthy");
    expect(result.checkStatuses[0].sliceCount).toBe(1);
    expect(result.checkStatuses[0].runsConsidered).toBe(3);
  });

  it("the per-env slice (concrete environmentId) is unaffected — only the rollup branch changed", async () => {
    // Pass an explicit environmentId; the per-env branch (string envId) still
    // filters to that env's slice via a single windowed query and reads unhealthy.
    const prodOnly = runs("unhealthy", 5);
    const assocWhere = mock(() =>
      Promise.resolve([
        {
          configurationId: "config-1",
          configName: "HTTP probe",
          enabled: true,
          paused: false,
          stateThresholds: null,
          environmentIds: null,
        },
      ]),
    );
    const assocInnerJoin = Object.assign(Promise.resolve([]), { where: assocWhere });
    const assocFrom = Object.assign(Promise.resolve([]), {
      innerJoin: mock(() => assocInnerJoin),
    });

    const runsLimit = mock(() => Promise.resolve(prodOnly));
    const runsOrderBy = mock(() => ({ limit: runsLimit }));
    const runsWhere = mock(() => ({ orderBy: runsOrderBy, limit: runsLimit }));
    const runsFrom = Object.assign(Promise.resolve(prodOnly), {
      where: runsWhere,
      orderBy: runsOrderBy,
    });

    let selectCallCount = 0;
    const mockDb = withTransactionMock({
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
    });

    const service = new HealthCheckService(mockDb as never, {} as never, {} as never);
    const result = await service.getSystemHealthStatus("system-1", "prod");
    expect(result.status).toBe("unhealthy");
    expect(result.checkStatuses[0].sliceCount).toBe(1);
    expect(result.checkStatuses[0].failingSliceCount).toBe(1);
  });
});
