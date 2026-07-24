import { describe, it, expect, mock } from "bun:test";
import { withTransactionMock } from "@checkstack/test-utils-backend";
import { HealthCheckService } from "./service";

/**
 * Regression: `getSystemHealthStatus` batches its 1 (associations) + N
 * (per-check run window) reads into ONE scoped transaction (see
 * `withScopedTransaction`), so the whole read fan-out pays a single
 * BEGIN/SET LOCAL/COMMIT and holds one connection instead of 1+N standalone
 * scoped queries. This pins that the reads run inside `db.transaction(...)`
 * (exactly once per call), independent of how many checks a system has.
 */
describe("HealthCheckService.getSystemHealthStatus - read batching", () => {
  function createMockDb(configCount: number) {
    const associations = Array.from({ length: configCount }, (_, i) => ({
      configurationId: `config-${i}`,
      configName: `Check ${i}`,
      enabled: true,
      paused: false,
      stateThresholds: null,
      // All-environments selector; each check has only the env-less slice below.
      environmentIds: null,
    }));
    const assocWhere = mock(() => Promise.resolve(associations));
    const assocInnerJoin = Object.assign(Promise.resolve([]), {
      where: assocWhere,
    });
    const assocFrom = Object.assign(Promise.resolve([]), {
      innerJoin: mock(() => assocInnerJoin),
    });

    // Each per-check run window returns one healthy run.
    const healthyRun = [
      { status: "healthy" as const, timestamp: new Date(), environmentId: null },
    ];
    const runsLimit = mock(() => Promise.resolve(healthyRun));
    const runsOrderBy = mock(() => ({ limit: runsLimit }));
    const runsWhere = mock(() => ({ orderBy: runsOrderBy, limit: runsLimit }));
    const runsFrom = Object.assign(Promise.resolve(healthyRun), {
      where: runsWhere,
      orderBy: runsOrderBy,
    });

    // Distinct env keys query per check: a single env-less (null) slice.
    const distinctFrom = Object.assign(Promise.resolve([]), {
      where: mock(() => Promise.resolve([{ environmentId: null }])),
    });

    let selectCallCount = 0;
    const db = withTransactionMock({
      select: mock(() => {
        selectCallCount += 1;
        if (selectCallCount === 1) return { from: mock(() => assocFrom) };
        return { from: mock(() => runsFrom) };
      }),
      selectDistinct: mock(() => ({ from: mock(() => distinctFrom) })),
      insert: mock(() => ({ values: mock(() => Promise.resolve()) })),
      update: mock(() => ({
        set: mock(() => ({ where: mock(() => Promise.resolve()) })),
      })),
      delete: mock(() => ({ where: mock(() => Promise.resolve()) })),
      execute: mock(() => Promise.resolve()),
    });
    return db;
  }

  it("wraps the associations + per-check reads in exactly ONE transaction", async () => {
    const mockDb = createMockDb(3);
    const service = new HealthCheckService(
      mockDb as never,
      {} as never,
      {} as never,
    );

    const result = await service.getSystemHealthStatus("system-1");

    expect(result.status).toBe("healthy");
    expect(result.checkStatuses).toHaveLength(3);
    // One transaction covers all 1 + N reads (not one per query).
    const transaction = (mockDb as unknown as { transaction: ReturnType<typeof mock> })
      .transaction;
    expect(transaction).toHaveBeenCalledTimes(1);
    // 1 associations select + 3 per-check run selects = 4 selects, all inside
    // the single transaction.
    const select = (mockDb as unknown as { select: ReturnType<typeof mock> })
      .select;
    expect(select).toHaveBeenCalledTimes(4);
  });

  it("still opens exactly one transaction for a system with no checks", async () => {
    const mockDb = createMockDb(0);
    const service = new HealthCheckService(
      mockDb as never,
      {} as never,
      {} as never,
    );

    const result = await service.getSystemHealthStatus("system-1");

    // `unknown`, not `healthy`: a system with no checks is unmeasured, and this
    // test is about transaction batching, not about inventing a status.
    expect(result.status).toBe("unknown");
    expect(result.checkStatuses).toHaveLength(0);
    const transaction = (mockDb as unknown as { transaction: ReturnType<typeof mock> })
      .transaction;
    expect(transaction).toHaveBeenCalledTimes(1);
  });
});
