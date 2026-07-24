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
 * (`null` = env-less) to that env's runs (DESC), all attributed to the LOCAL
 * core; `satelliteRuns` adds slices probed from a satellite. `environmentIds` is
 * the assignment's selector under test.
 *
 * The per-slice runs query resolves against the env id AND source id bound in
 * its predicate. Known env ids and satellite ids are disjoint in these fixtures,
 * so each is recovered by set membership; an absent value means the `isNull`
 * clause, i.e. the env-less / local slice.
 */
function createRollupMockDb(props: {
  runsByEnv: Map<string | null, Run[]>;
  environmentIds: string[] | null;
  satelliteRuns?: { sourceId: string; environmentId: string | null; runs: Run[] }[];
  satelliteIds?: string[] | null;
  satelliteEnvironmentIds?: Record<string, string[] | null> | null;
  includeLocal?: boolean;
}) {
  const {
    runsByEnv,
    environmentIds,
    satelliteRuns = [],
    satelliteIds = null,
    satelliteEnvironmentIds = null,
    includeLocal = true,
  } = props;
  const slices = [
    ...[...runsByEnv].map(([environmentId, runs]) => ({
      environmentId,
      sourceId: null as string | null,
      runs,
    })),
    ...satelliteRuns,
  ];
  const knownEnvIds = new Set(
    slices
      .map((s) => s.environmentId)
      .filter((k): k is string => k !== null),
  );
  const knownSourceIds = new Set(
    slices.map((s) => s.sourceId).filter((k): k is string => k !== null),
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
        satelliteIds,
        satelliteEnvironmentIds,
        includeLocal,
      },
    ]),
  );
  const assocInnerJoin = Object.assign(Promise.resolve([]), {
    where: assocWhere,
  });
  const assocFrom = Object.assign(Promise.resolve([]), {
    innerJoin: mock(() => assocInnerJoin),
  });

  // Per-slice runs query: pick the slice named by the predicate's env + source.
  const resolveSlice = (predicate: unknown): Run[] => {
    const values = collectPredicateValues(predicate);
    const environmentId = values.find((v) => knownEnvIds.has(v)) ?? null;
    const sourceId = values.find((v) => knownSourceIds.has(v)) ?? null;
    return (
      slices.find(
        (s) => s.environmentId === environmentId && s.sourceId === sourceId,
      )?.runs ?? []
    );
  };
  const runsFromFor = () => {
    const runsWhere = mock((predicate: unknown) => {
      const rows = resolveSlice(predicate);
      const limit = mock(() => Promise.resolve(rows));
      return { orderBy: mock(() => ({ limit })), limit };
    });
    return Object.assign(Promise.resolve([]), { where: runsWhere });
  };

  // Distinct slice keys query: selectDistinct({environmentId, sourceId}).
  const distinctFrom = Object.assign(Promise.resolve([]), {
    where: mock(() =>
      Promise.resolve(
        slices.map(({ environmentId, sourceId }) => ({
          environmentId,
          sourceId,
        })),
      ),
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

  it("reports unhealthy when the LOCAL check passes but a SATELLITE check fails", async () => {
    // The reported bug (@stuajnht): a system read HEALTHY while one of its
    // probe locations failed every single time. Both sources' runs landed in
    // one slice, so `evaluateConsecutive` saw healthy/unhealthy alternating,
    // broke its streak on every run, met no threshold, and fell through to its
    // healthy default. Sliced per source, the satellite is evaluated on its own
    // and worst-wins carries it to the system.
    const runsByEnv = new Map<string | null, Run[]>([[null, runs("healthy", 5)]]);
    const mockDb = createRollupMockDb({
      runsByEnv,
      environmentIds: null,
      satelliteIds: ["sat-eu"],
      satelliteRuns: [
        { sourceId: "sat-eu", environmentId: null, runs: runs("unhealthy", 5) },
      ],
    });
    const service = new HealthCheckService(mockDb as never, {} as never, {} as never);

    const result = await service.getSystemHealthStatus("system-1");

    expect(result.status).toBe("unhealthy");
    expect(result.checkStatuses[0].status).toBe("unhealthy");
    // Two locations probing one environment = two slices, one failing.
    expect(result.checkStatuses[0].sliceCount).toBe(2);
    expect(result.checkStatuses[0].failingSliceCount).toBe(1);
  });

  it("names the failing location in the per-slice breakdown", async () => {
    const runsByEnv = new Map<string | null, Run[]>([["prod", runs("healthy", 5)]]);
    const mockDb = createRollupMockDb({
      runsByEnv,
      environmentIds: ["prod"],
      satelliteIds: ["sat-eu"],
      satelliteRuns: [
        { sourceId: "sat-eu", environmentId: "prod", runs: runs("unhealthy", 5) },
      ],
    });
    const service = new HealthCheckService(mockDb as never, {} as never, {} as never);

    const { slices } = (await service.getSystemHealthStatus("system-1")).checkStatuses[0];

    expect(slices).toHaveLength(2);
    expect(slices.find((s) => s.sourceId === null)?.status).toBe("healthy");
    expect(slices.find((s) => s.sourceId === "sat-eu")?.status).toBe("unhealthy");
  });

  it("drops a de-assigned satellite's stale failing runs", async () => {
    // No health-change event fires for a slice that merely stopped producing
    // runs, so without the effective-source filter an unassigned satellite's
    // last failures would drag the rollup until they aged out of the window.
    const runsByEnv = new Map<string | null, Run[]>([[null, runs("healthy", 5)]]);
    const mockDb = createRollupMockDb({
      runsByEnv,
      environmentIds: null,
      satelliteIds: [],
      satelliteRuns: [
        { sourceId: "sat-gone", environmentId: null, runs: runs("unhealthy", 5) },
      ],
    });
    const service = new HealthCheckService(mockDb as never, {} as never, {} as never);

    const result = await service.getSystemHealthStatus("system-1");

    expect(result.status).toBe("healthy");
    expect(result.checkStatuses[0].sliceCount).toBe(1);
  });

  it("keeps evaluating satellites when the core stopped running the check", async () => {
    // `includeLocal: false` means the core's old runs no longer contribute, so
    // the satellite alone decides.
    const runsByEnv = new Map<string | null, Run[]>([[null, runs("healthy", 5)]]);
    const mockDb = createRollupMockDb({
      runsByEnv,
      environmentIds: null,
      includeLocal: false,
      satelliteIds: ["sat-eu"],
      satelliteRuns: [
        { sourceId: "sat-eu", environmentId: null, runs: runs("unhealthy", 5) },
      ],
    });
    const service = new HealthCheckService(mockDb as never, {} as never, {} as never);

    const result = await service.getSystemHealthStatus("system-1");

    expect(result.status).toBe("unhealthy");
    expect(result.checkStatuses[0].sliceCount).toBe(1);
    expect(result.checkStatuses[0].failingSliceCount).toBe(1);
  });

  it("a pinned environment evaluates only that environment's slices", async () => {
    // Passing an explicit environmentId narrows to that env - the other env's
    // runs must not contribute - while the source dimension is still sliced.
    const runsByEnv = new Map<string | null, Run[]>([
      ["prod", runs("unhealthy", 5)],
      ["staging", runs("healthy", 5)],
    ]);
    const mockDb = createRollupMockDb({ runsByEnv, environmentIds: null });
    const service = new HealthCheckService(mockDb as never, {} as never, {} as never);

    const result = await service.getSystemHealthStatus("system-1", "prod");
    expect(result.status).toBe("unhealthy");
    expect(result.checkStatuses[0].sliceCount).toBe(1);
    expect(result.checkStatuses[0].failingSliceCount).toBe(1);
    expect(result.checkStatuses[0].runsConsidered).toBe(5);
  });
});
