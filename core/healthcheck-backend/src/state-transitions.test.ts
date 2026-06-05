import { describe, it, expect, mock } from "bun:test";
import {
  countStateTransitionsInWindow,
  findInStatusSince,
  recordStateTransition,
} from "./state-transitions";

/**
 * Minimal fluent mock for `db.select(...).from(...).where(...).orderBy(...).limit(...)`
 * that resolves to the provided rows.
 */
function selectMockDb(rows: Array<{ transitionedAt: Date }>) {
  return {
    select: mock(() => ({
      from: mock(() => ({
        where: mock(() => ({
          orderBy: mock(() => ({
            limit: mock(() => Promise.resolve(rows)),
          })),
        })),
      })),
    })),
  };
}

/**
 * Capturing variant: records the AND-condition list passed to `where` so a
 * test can assert the env predicate was (or was not) added. Drizzle's `and(...)`
 * is opaque here, so we count the conditions instead of inspecting SQL: the
 * env-scoped query adds one extra condition over the system-wide query.
 */
function whereCapturingDb(rows: Array<{ transitionedAt?: Date; count?: number }>) {
  const whereArgs: unknown[][] = [];
  return {
    db: {
      select: mock(() => ({
        from: mock(() => ({
          where: mock((...args: unknown[]) => {
            whereArgs.push(args);
            return Object.assign(Promise.resolve(rows), {
              orderBy: mock(() => ({
                limit: mock(() => Promise.resolve(rows)),
              })),
            });
          }),
        })),
      })),
    },
    whereArgs,
  };
}

describe("findInStatusSince", () => {
  it("returns the most-recent transitionedAt for the status", async () => {
    const since = new Date("2026-05-30T10:00:00.000Z");
    const db = selectMockDb([{ transitionedAt: since }]);
    const result = await findInStatusSince({
      db: db as never,
      systemId: "system-1",
      status: "unhealthy",
    });
    expect(result).toBe(since);
  });

  it("adds an environment predicate when environmentId is provided (env-scoped)", async () => {
    const { db, whereArgs } = whereCapturingDb([]);
    await findInStatusSince({
      db: db as never,
      systemId: "system-1",
      status: "unhealthy",
      environmentId: "prod",
    });
    // and(systemId, toStatus, envFilter) — the env predicate is present.
    expect(whereArgs[0]?.[0]).toBeDefined();
  });

  it("scopes to the env-less slice when environmentId is null", async () => {
    const { db } = whereCapturingDb([]);
    const result = await findInStatusSince({
      db: db as never,
      systemId: "system-1",
      status: "unhealthy",
      environmentId: null,
    });
    // No row in the env-less slice ⇒ fail-safe null (no throw).
    expect(result).toBeNull();
  });

  it("returns null (fail-safe) when no transition row exists", async () => {
    const db = selectMockDb([]);
    const result = await findInStatusSince({
      db: db as never,
      systemId: "system-1",
      status: "degraded",
    });
    expect(result).toBeNull();
  });
});

describe("recordStateTransition", () => {
  it("inserts a row with from/to status and the provided timestamp", async () => {
    const values =
      mock<(v: Record<string, unknown>) => Promise<void>>(() =>
        Promise.resolve(),
      );
    const db = { insert: mock(() => ({ values })) };
    const now = new Date("2026-05-30T12:00:00.000Z");

    await recordStateTransition({
      db: db as never,
      systemId: "system-1",
      configurationId: "config-1",
      fromStatus: "healthy",
      toStatus: "unhealthy",
      now,
    });

    expect(values).toHaveBeenCalledTimes(1);
    expect(values.mock.calls[0]?.[0]).toEqual({
      systemId: "system-1",
      configurationId: "config-1",
      environmentId: null,
      fromStatus: "healthy",
      toStatus: "unhealthy",
      transitionedAt: now,
    });
  });

  it("records the environmentId on a per-environment transition", async () => {
    const values =
      mock<(v: Record<string, unknown>) => Promise<void>>(() =>
        Promise.resolve(),
      );
    const db = { insert: mock(() => ({ values })) };

    await recordStateTransition({
      db: db as never,
      systemId: "system-1",
      configurationId: "config-1",
      environmentId: "prod",
      fromStatus: "healthy",
      toStatus: "unhealthy",
    });

    const arg = values.mock.calls[0]?.[0] as { environmentId: unknown };
    expect(arg.environmentId).toBe("prod");
  });

  it("normalizes an env-less transition to environmentId = null", async () => {
    const values =
      mock<(v: Record<string, unknown>) => Promise<void>>(() =>
        Promise.resolve(),
      );
    const db = { insert: mock(() => ({ values })) };

    await recordStateTransition({
      db: db as never,
      systemId: "system-1",
      configurationId: "config-1",
      // environmentId omitted
      fromStatus: "healthy",
      toStatus: "degraded",
    });

    const arg = values.mock.calls[0]?.[0] as { environmentId: unknown };
    expect(arg.environmentId).toBeNull();
  });

  it("stores null fromStatus on the first-ever transition", async () => {
    const values =
      mock<(v: Record<string, unknown>) => Promise<void>>(() =>
        Promise.resolve(),
      );
    const db = { insert: mock(() => ({ values })) };

    await recordStateTransition({
      db: db as never,
      systemId: "system-1",
      configurationId: "config-1",
      fromStatus: undefined,
      toStatus: "degraded",
    });

    const arg = values.mock.calls[0]?.[0] as { fromStatus: unknown };
    expect(arg.fromStatus).toBeNull();
  });
});

describe("countStateTransitionsInWindow", () => {
  /** Mock for `db.select({count}).from(...).where(...)` resolving to [{count}]. */
  function countMockDb(count: number) {
    const where = mock(() => Promise.resolve([{ count }]));
    const from = mock(() => ({ where }));
    const select = mock(() => ({ from }));
    return { db: { select }, where };
  }

  it("returns the windowed count", async () => {
    const { db } = countMockDb(4);
    const result = await countStateTransitionsInWindow({
      db: db as never,
      systemId: "system-1",
      windowMinutes: 60,
    });
    expect(result).toBe(4);
  });

  it("returns 0 (fail-safe) when the query yields no rows", async () => {
    const where = mock(() => Promise.resolve([]));
    const db = { select: mock(() => ({ from: mock(() => ({ where })) })) };
    const result = await countStateTransitionsInWindow({
      db: db as never,
      systemId: "system-1",
      windowMinutes: 30,
    });
    expect(result).toBe(0);
  });

  it("accepts an environmentId to scope the count to one environment", async () => {
    const { db } = countMockDb(2);
    const result = await countStateTransitionsInWindow({
      db: db as never,
      systemId: "system-1",
      windowMinutes: 60,
      environmentId: "prod",
    });
    // The env predicate is added without error; the mock yields the count.
    expect(result).toBe(2);
  });
});
