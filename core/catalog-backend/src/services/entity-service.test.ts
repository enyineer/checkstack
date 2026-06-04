import { describe, it, expect, mock } from "bun:test";
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
});
