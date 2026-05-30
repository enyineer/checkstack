import { describe, it, expect, mock } from "bun:test";
import { findInStatusSince, recordStateTransition } from "./state-transitions";

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
      fromStatus: "healthy",
      toStatus: "unhealthy",
      transitionedAt: now,
    });
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
