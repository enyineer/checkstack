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

  // Read-batching methods (listMaintenances, getManyEntityStates, ...) now run
  // their reads inside `withScopedTransaction` -> `db.transaction(fn)`. The tx
  // exposes the SAME `select` mock so the per-invocation call counter and the
  // recorded `whereArgs` still reflect every query issued.
  const transaction = mock((fn: (tx: { select: typeof select }) => unknown) =>
    Promise.resolve(fn({ select })),
  );

  return {
    db: { select, transaction } as unknown,
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

const createdAt = new Date("2026-06-01T10:00:00.000Z");
const updatedAt = new Date("2026-06-01T10:05:00.000Z");
const startAt = new Date("2026-06-02T00:00:00.000Z");
const endAt = new Date("2026-06-02T02:00:00.000Z");
const maintenanceRow = (id: string, description: string | null) => ({
  id,
  title: id,
  description,
  suppressNotifications: false,
  status: "scheduled" as const,
  startAt,
  endAt,
  createdAt,
  updatedAt,
});

describe("MaintenanceService.listMaintenances (set-based system grouping)", () => {
  it("fetches all system associations in ONE junction query (no N+1) and groups them", async () => {
    const { db, getCallCount } = createRecordingDb([
      // 1st: the maintenances matching the status filter.
      [maintenanceRow("m-1", null), maintenanceRow("m-2", "planned db upgrade")],
      // 2nd (and ONLY): a single inArray junction read for BOTH maintenances.
      [
        { maintenanceId: "m-1", systemId: "sys-a" },
        { maintenanceId: "m-1", systemId: "sys-b" },
        { maintenanceId: "m-2", systemId: "sys-c" },
      ],
    ]);
    const service = new MaintenanceService(db as never);

    const out = await service.listMaintenances({ includeCompleted: true });

    expect(out.map((m) => m.id)).toEqual(["m-1", "m-2"]);
    expect(out[0].systemIds).toEqual(["sys-a", "sys-b"]);
    expect(out[1].systemIds).toEqual(["sys-c"]);
    expect(out[0].description).toBeUndefined();
    expect(out[1].description).toBe("planned db upgrade");
    // 1 maintenances read + exactly 1 junction read, regardless of row count.
    expect(getCallCount()).toBe(2);
  });

  it("resolves the system's maintenance ids first when filtering by systemId (3 queries total)", async () => {
    const { db, getCallCount } = createRecordingDb([
      // 1st: maintenance ids attached to the system.
      [{ maintenanceId: "m-1" }],
      // 2nd: the maintenances themselves (status-filtered).
      [maintenanceRow("m-1", null)],
      // 3rd: the single junction grouping read.
      [{ maintenanceId: "m-1", systemId: "sys-a" }],
    ]);
    const service = new MaintenanceService(db as never);

    const out = await service.listMaintenances({ systemId: "sys-a" });

    expect(out.map((m) => m.id)).toEqual(["m-1"]);
    expect(out[0].systemIds).toEqual(["sys-a"]);
    expect(getCallCount()).toBe(3);
  });
});

describe("MaintenanceService.getMaintenance (batched detail read)", () => {
  it("assembles the detail from maintenance + systems + updates + links (4 queries, one tx)", async () => {
    const { db, getCallCount } = createRecordingDb([
      // 1st: the maintenance row.
      [maintenanceRow("m-1", null)],
      // 2nd: system associations.
      [{ systemId: "sys-a" }, { systemId: "sys-b" }],
      // 3rd: the full (unfiltered) timeline.
      [
        {
          id: "u1",
          maintenanceId: "m-1",
          message: "starting",
          statusChange: "in_progress",
          visibility: "public",
          createdAt,
          editedAt: null,
          createdBy: null,
        },
      ],
      // 4th: hotlinks.
      [
        {
          id: "lnk-1",
          maintenanceId: "m-1",
          label: "Plan",
          url: "https://a",
          visibility: "public",
          createdAt,
        },
      ],
    ]);
    const service = new MaintenanceService(db as never);

    const out = await service.getMaintenance("m-1");

    expect(out?.systemIds).toEqual(["sys-a", "sys-b"]);
    expect(out?.description).toBeUndefined();
    expect(out?.updates).toEqual([
      {
        id: "u1",
        maintenanceId: "m-1",
        message: "starting",
        statusChange: "in_progress",
        visibility: "public",
        createdAt,
        editedAt: undefined,
        editHistory: [],
        createdBy: undefined,
      },
    ]);
    expect(out?.links.map((l) => l.id)).toEqual(["lnk-1"]);
    expect(getCallCount()).toBe(4);
  });

  it("returns undefined after a single query when the maintenance is absent", async () => {
    const { db, getCallCount } = createRecordingDb([[]]);
    const service = new MaintenanceService(db as never);
    expect(await service.getMaintenance("ghost")).toBeUndefined();
    expect(getCallCount()).toBe(1);
  });
});

describe("MaintenanceService.getMaintenancesForSystem (set-based system grouping)", () => {
  it("groups memberships from ONE junction query after resolving the system's maintenances", async () => {
    const { db, getCallCount } = createRecordingDb([
      // 1st: maintenance ids attached to the system.
      [{ maintenanceId: "m-1" }, { maintenanceId: "m-2" }],
      // 2nd: scheduled/in_progress maintenances for those ids.
      [maintenanceRow("m-1", null), maintenanceRow("m-2", null)],
      // 3rd (and ONLY) junction read for BOTH maintenances' full membership.
      [
        { maintenanceId: "m-1", systemId: "sys-a" },
        { maintenanceId: "m-1", systemId: "sys-b" },
        { maintenanceId: "m-2", systemId: "sys-a" },
      ],
    ]);
    const service = new MaintenanceService(db as never);

    const out = await service.getMaintenancesForSystem("sys-a");

    expect(out.map((m) => m.id)).toEqual(["m-1", "m-2"]);
    expect(out[0].systemIds).toEqual(["sys-a", "sys-b"]);
    expect(out[1].systemIds).toEqual(["sys-a"]);
    expect(getCallCount()).toBe(3);
  });

  it("returns [] without a junction query when the system has no maintenances", async () => {
    const { db, getCallCount } = createRecordingDb([[]]);
    const service = new MaintenanceService(db as never);
    expect(await service.getMaintenancesForSystem("sys-x")).toEqual([]);
    expect(getCallCount()).toBe(1);
  });
});
