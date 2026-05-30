import { describe, it, expect, mock } from "bun:test";
import { pruneStateTransitions } from "./retention-job";

/**
 * Mock db exposing the two shapes pruneStateTransitions uses:
 * - select(...).from(...).where(...).orderBy(...).limit(...) -> newest row
 * - delete(...).where(...) -> prune
 */
function makeMockDb(newestRows: Array<{ id: string }>) {
  const where = mock(() => Promise.resolve());
  const db = {
    select: mock(() => ({
      from: mock(() => ({
        where: mock(() => ({
          orderBy: mock(() => ({
            limit: mock(() => Promise.resolve(newestRows)),
          })),
        })),
      })),
    })),
    delete: mock(() => ({ where })),
  };
  return { db, deleteWhere: where };
}

describe("pruneStateTransitions", () => {
  it("issues a delete that preserves the newest row when one exists", async () => {
    const { db, deleteWhere } = makeMockDb([{ id: "newest-id" }]);
    await pruneStateTransitions({
      db: db as never,
      systemId: "system-1",
      rawRetentionDays: 7,
    });
    expect(db.select).toHaveBeenCalledTimes(1);
    expect(db.delete).toHaveBeenCalledTimes(1);
    expect(deleteWhere).toHaveBeenCalledTimes(1);
  });

  it("still issues a delete (cutoff-only) when the table is empty for the system", async () => {
    const { db, deleteWhere } = makeMockDb([]);
    await pruneStateTransitions({
      db: db as never,
      systemId: "system-1",
      rawRetentionDays: 7,
    });
    expect(db.delete).toHaveBeenCalledTimes(1);
    expect(deleteWhere).toHaveBeenCalledTimes(1);
  });
});
