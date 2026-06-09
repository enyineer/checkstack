import { describe, it, expect, mock } from "bun:test";
import { MaintenanceService } from "./service";

/**
 * Programmable mock DB that records the predicate passed to each
 * `select(...).from(...).where(...)` chain and returns a configurable row
 * array per invocation. The real drizzle query-builder calls inside
 * `MaintenanceService` run unchanged; only the terminal data source and the
 * captured `where(...)` argument are swapped out, so a test can assert WHICH
 * status predicate the service chose without a live database.
 */
function createRecordingDb(resultsByCall: unknown[][]) {
  let callIndex = 0;
  const whereArgs: unknown[] = [];

  const select = mock(() => {
    const rows = resultsByCall[callIndex] ?? [];
    callIndex += 1;

    const limit = mock(() => Promise.resolve(rows));
    const where = mock((condition?: unknown) => {
      whereArgs.push(condition);
      return Object.assign(Promise.resolve(rows), { limit });
    });
    const from = mock(() => Object.assign(Promise.resolve(rows), { where }));
    return { from };
  });

  return {
    db: { select } as unknown,
    whereArgs,
    getCallCount: () => callIndex,
  };
}

describe("MaintenanceService.listMaintenances includeCompleted filter", () => {
  it("hides completed maintenances by default (applies a status predicate)", async () => {
    // Main query returns no rows, so no per-row system lookups follow and
    // whereArgs[0] is exactly the predicate handed to the maintenances query.
    const { db, whereArgs, getCallCount } = createRecordingDb([[]]);
    const service = new MaintenanceService(db as never);

    const result = await service.listMaintenances();

    expect(result).toEqual([]);
    // Only the main query ran; the empty result skips per-row system fetches.
    expect(getCallCount()).toBe(1);
    // `ne(maintenances.status, "completed")` -> a defined predicate.
    expect(whereArgs[0]).toBeDefined();
  });

  it("includes completed maintenances when includeCompleted=true (no status predicate)", async () => {
    const { db, whereArgs } = createRecordingDb([[]]);
    const service = new MaintenanceService(db as never);

    await service.listMaintenances({ includeCompleted: true });

    // No status filter -> the whole table, so the predicate is undefined.
    expect(whereArgs[0]).toBeUndefined();
  });

  it("lets an explicit status filter win over includeCompleted", async () => {
    const { db, whereArgs } = createRecordingDb([[]]);
    const service = new MaintenanceService(db as never);

    // includeCompleted is irrelevant once a concrete status is requested.
    await service.listMaintenances({ status: "completed", includeCompleted: false });

    // `eq(maintenances.status, "completed")` -> a defined predicate.
    expect(whereArgs[0]).toBeDefined();
  });
});
