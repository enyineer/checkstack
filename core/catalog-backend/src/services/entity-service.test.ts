import { describe, it, expect, mock } from "bun:test";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { withTransactionMock } from "@checkstack/test-utils-backend";
import { EntityService } from "./entity-service";
import * as schema from "../schema";
import { SafeDatabase } from "@checkstack/backend-api";

/**
 * Build a transaction-capable mock db whose `select().from(table)` returns the
 * canned rows for that table (a thenable that also answers `.where()` and
 * `.orderBy()`), and that records every insert/delete so batched write groups
 * can be asserted. `withTransactionMock` makes `withScopedTransaction` run the
 * callback against this same db, so ordering and table routing are preserved.
 */
function makeBatchMockDb(tables: {
  systems?: unknown[];
  groups?: unknown[];
  systemsGroups?: unknown[];
  environments?: unknown[];
  systemsEnvironments?: unknown[];
}) {
  const rowsFor = (table: unknown): unknown[] => {
    if (table === schema.systems) return tables.systems ?? [];
    if (table === schema.groups) return tables.groups ?? [];
    if (table === schema.systemsGroups) return tables.systemsGroups ?? [];
    if (table === schema.environments) return tables.environments ?? [];
    if (table === schema.systemsEnvironments) {
      return tables.systemsEnvironments ?? [];
    }
    return [];
  };
  const inserted: Array<{ table: unknown; values: unknown }> = [];
  const deleted: Array<{ table: unknown; cond: unknown }> = [];
  const db = {
    select: mock(() => ({
      from: mock((table: unknown) => {
        const rows = rowsFor(table);
        return Object.assign(Promise.resolve(rows), {
          where: mock(() => Promise.resolve(rows)),
          orderBy: mock(() => Promise.resolve(rows)),
        });
      }),
    })),
    insert: mock((table: unknown) => ({
      values: mock((values: unknown) => {
        inserted.push({ table, values });
        return { onConflictDoNothing: mock(() => Promise.resolve()) };
      }),
    })),
    delete: mock((table: unknown) => ({
      where: mock((cond: unknown) => {
        deleted.push({ table, cond });
        return Promise.resolve();
      }),
    })),
  };
  const withTx = withTransactionMock(db);
  return {
    // Test-only mock; casting to the full drizzle db type is unavoidable.
    db: withTx as unknown as SafeDatabase<typeof schema>,
    transaction: withTx.transaction,
    inserted,
    deleted,
  };
}

describe("EntityService", () => {
  const mockDb = {
    select: mock(() => ({
      from: mock(() => []),
    })),
    insert: mock(() => ({
      values: mock(() => ({
        returning: mock(() => []),
      })),
    })),
    update: mock(() => ({
      set: mock(() => ({
        where: mock(() => ({
          returning: mock(() => []),
        })),
      })),
    })),
    delete: mock(() => ({
      where: mock(() => Promise.resolve()),
    })),
  } as unknown as SafeDatabase<typeof schema>;

  const service = new EntityService(mockDb);

  it("should get systems", async () => {
    await service.getSystems();
    expect(mockDb.select).toHaveBeenCalled();
  });

  it("should create system", async () => {
    const data = { id: "test", name: "Test" };
    const fullSystem = {
      ...data,
      description: null,
      status: "healthy" as "healthy" | "degraded" | "unhealthy",
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    (mockDb.insert as any).mockReturnValue({
      values: mock(() => ({
        returning: mock(() => [fullSystem]),
      })),
    });

    const result = await service.createSystem(data);
    expect(result).toEqual(fullSystem);
    expect(mockDb.insert).toHaveBeenCalledWith(schema.systems);
  });

  it("should update system", async () => {
    const data = { name: "Updated" };
    const fullSystem = {
      id: "test",
      name: "Updated",
      description: null,
      status: "healthy" as "healthy" | "degraded" | "unhealthy",
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    (mockDb.update as any).mockReturnValue({
      set: mock(() => ({
        where: mock(() => ({
          returning: mock(() => [fullSystem]),
        })),
      })),
    });

    const result = await service.updateSystem("test", data);
    expect(result).toEqual(fullSystem);
    expect(mockDb.update).toHaveBeenCalledWith(schema.systems);
  });

  it("should delete system", async () => {
    await service.deleteSystem("test");
    expect(mockDb.delete).toHaveBeenCalledWith(schema.systems);
  });

  it("getSystemByName returns the matching system", async () => {
    const row = {
      id: "s1",
      name: "Payments",
      description: null,
      status: "healthy" as "healthy" | "degraded" | "unhealthy",
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    (mockDb.select as any).mockReturnValue({
      from: mock(() => ({ where: mock(() => Promise.resolve([row])) })),
    });

    const result = await service.getSystemByName("Payments");
    expect(result).toEqual(row);
    expect(mockDb.select).toHaveBeenCalled();
  });

  it("getSystemByName returns undefined when the name is free", async () => {
    (mockDb.select as any).mockReturnValue({
      from: mock(() => ({ where: mock(() => Promise.resolve([])) })),
    });

    const result = await service.getSystemByName("Unused Name");
    expect(result).toBeUndefined();
  });

  // Regression guard for an IDOR: the per-system manage check (instanceAccess)
  // only proves the caller manages `systemId`, so a child delete MUST also
  // constrain on systemId. Without it, a manager of system A could delete
  // system B's contact/link by passing a foreign child id. We render the
  // captured WHERE clause to SQL and assert BOTH columns are constrained.
  const renderWhere = (captured: { current: SQL | undefined }) => {
    expect(captured.current).toBeDefined();
    if (!captured.current) throw new Error("no where clause captured");
    return new PgDialect().sqlToQuery(captured.current).sql;
  };

  it("removeContact scopes the delete to BOTH contact id and systemId", async () => {
    const captured: { current: SQL | undefined } = { current: undefined };
    (mockDb.delete as any).mockReturnValue({
      where: mock((cond: SQL) => {
        captured.current = cond;
        return { returning: mock(() => Promise.resolve([])) };
      }),
    });

    await service.removeContact({ contactId: "c1", systemId: "s1" });

    expect(mockDb.delete).toHaveBeenCalledWith(schema.systemContacts);
    const sql = renderWhere(captured);
    expect(sql).toContain('"id"');
    expect(sql).toContain('"system_id"');
  });

  it("removeContact returns undefined when no row matches both predicates", async () => {
    (mockDb.delete as any).mockReturnValue({
      where: mock(() => ({ returning: mock(() => Promise.resolve([])) })),
    });

    const result = await service.removeContact({
      contactId: "foreign",
      systemId: "s1",
    });
    expect(result).toBeUndefined();
  });

  it("removeLink scopes the delete to BOTH link id and systemId", async () => {
    const captured: { current: SQL | undefined } = { current: undefined };
    (mockDb.delete as any).mockReturnValue({
      where: mock((cond: SQL) => {
        captured.current = cond;
        return { returning: mock(() => Promise.resolve([])) };
      }),
    });

    await service.removeLink({ linkId: "l1", systemId: "s1" });

    expect(mockDb.delete).toHaveBeenCalledWith(schema.systemLinks);
    const sql = renderWhere(captured);
    expect(sql).toContain('"id"');
    expect(sql).toContain('"system_id"');
  });

  it("removeLink returns undefined when no row matches both predicates", async () => {
    (mockDb.delete as any).mockReturnValue({
      where: mock(() => ({ returning: mock(() => Promise.resolve([])) })),
    });

    const result = await service.removeLink({
      linkId: "foreign",
      systemId: "s1",
    });
    expect(result).toBeUndefined();
  });

  it("updateLink scopes the update to BOTH link id and systemId", async () => {
    const captured: { current: SQL | undefined } = { current: undefined };
    const updated = {
      id: "l1",
      systemId: "s1",
      label: "New label",
      url: "https://new",
      createdAt: new Date(),
    };
    (mockDb.update as any).mockReturnValue({
      set: mock(() => ({
        where: mock((cond: SQL) => {
          captured.current = cond;
          return { returning: mock(() => Promise.resolve([updated])) };
        }),
      })),
    });

    const result = await service.updateLink({
      linkId: "l1",
      systemId: "s1",
      label: "New label",
      url: "https://new",
    });

    expect(result).toEqual(updated);
    expect(mockDb.update).toHaveBeenCalledWith(schema.systemLinks);
    const sql = renderWhere(captured);
    expect(sql).toContain('"id"');
    expect(sql).toContain('"system_id"');
  });

  it("updateLink with no changed fields reads the row scoped to both predicates", async () => {
    const captured: { current: SQL | undefined } = { current: undefined };
    const existing = {
      id: "l1",
      systemId: "s1",
      label: "Existing",
      url: "https://a",
      createdAt: new Date(),
    };
    (mockDb.select as any).mockReturnValue({
      from: mock(() => ({
        where: mock((cond: SQL) => {
          captured.current = cond;
          return Promise.resolve([existing]);
        }),
      })),
    });

    const result = await service.updateLink({ linkId: "l1", systemId: "s1" });

    // With no fields to change, the row is read back (scoped to both
    // predicates) rather than issuing an empty UPDATE.
    expect(result).toEqual(existing);
    const sql = renderWhere(captured);
    expect(sql).toContain('"id"');
    expect(sql).toContain('"system_id"');
  });

  // §perf batching: getEntities reads systems + groups (+ memberships) under
  // ONE scoped transaction. Assert the batched read runs in a transaction and
  // still produces the identical { systems, groups-with-systemIds } shape.
  it("getEntitiesTopology batches systems + groups in one transaction", async () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const systems = [
      { id: "s1", name: "Api", description: null, metadata: null, createdAt: now, updatedAt: now },
    ];
    const groups = [
      { id: "g1", name: "Core", sortOrder: 0, metadata: null, createdAt: now, updatedAt: now },
      { id: "g2", name: "Edge", sortOrder: 1, metadata: null, createdAt: now, updatedAt: now },
    ];
    const systemsGroups = [{ groupId: "g1", systemId: "s1" }];
    const { db, transaction } = makeBatchMockDb({
      systems,
      groups,
      systemsGroups,
    });
    const svc = new EntityService(db);

    const result = await svc.getEntitiesTopology();

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(result.systems).toEqual(systems);
    expect(result.groups).toEqual([
      { id: "g1", name: "Core", sortOrder: 0, metadata: null, createdAt: now, updatedAt: now, systemIds: ["s1"] },
      { id: "g2", name: "Edge", sortOrder: 1, metadata: null, createdAt: now, updatedAt: now, systemIds: [] },
    ]);
  });

  // §perf batching + atomicity: setSystemEnvironments reads current membership
  // then applies the desired-set diff (adds + removes) inside ONE transaction.
  it("setSystemEnvironments adds/removes the diff inside one transaction", async () => {
    const { db, transaction, inserted, deleted } = makeBatchMockDb({
      // Current membership for the system: e1 only.
      systemsEnvironments: [{ environmentId: "e1", systemId: "sys1" }],
    });
    const svc = new EntityService(db);

    // Desired: e1 kept, e2 added, e1-only-current means nothing removed.
    await svc.setSystemEnvironments({
      systemId: "sys1",
      environmentIds: ["e1", "e2"],
    });

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(inserted).toEqual([
      { table: schema.systemsEnvironments, values: { environmentId: "e2", systemId: "sys1" } },
    ]);
    expect(deleted).toEqual([]);
  });

  it("setSystemEnvironments removes memberships dropped from the desired set", async () => {
    const { db, inserted, deleted } = makeBatchMockDb({
      systemsEnvironments: [{ environmentId: "e1", systemId: "sys1" }],
    });
    const svc = new EntityService(db);

    // Desired swaps e1 -> e3: e3 inserted, e1 deleted.
    await svc.setSystemEnvironments({
      systemId: "sys1",
      environmentIds: ["e3"],
    });

    expect(inserted).toEqual([
      { table: schema.systemsEnvironments, values: { environmentId: "e3", systemId: "sys1" } },
    ]);
    expect(deleted).toEqual([
      { table: schema.systemsEnvironments, cond: expect.anything() },
    ]);
  });
});
