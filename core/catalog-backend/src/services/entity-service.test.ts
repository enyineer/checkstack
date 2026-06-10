import { describe, it, expect, mock } from "bun:test";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { EntityService } from "./entity-service";
import * as schema from "../schema";
import { SafeDatabase } from "@checkstack/backend-api";

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
});
