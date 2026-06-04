import { describe, expect, test, mock } from "bun:test";
import type { AuthUser, RpcClient } from "@checkstack/backend-api";
import { createMaintenanceDeleteTool } from "./maintenance-delete";

const principal: AuthUser = {
  type: "user",
  id: "u1",
  accessRules: ["maintenance.maintenance.manage"],
};

const maintenance = {
  id: "m1",
  title: "DB upgrade",
  description: "Planned upgrade",
  suppressNotifications: false,
  status: "scheduled" as const,
  startAt: new Date(),
  endAt: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
  systemIds: ["s1"],
  updates: [],
  links: [],
};

function fakeRpcClient({
  getMaintenance,
  deleteMaintenance,
}: {
  getMaintenance: ReturnType<typeof mock>;
  deleteMaintenance: ReturnType<typeof mock>;
}): RpcClient {
  return {
    forPlugin: () => ({ getMaintenance, deleteMaintenance }),
  } as unknown as RpcClient;
}

describe("maintenance.delete tool", () => {
  test("declares destructive effect + the manage rule", () => {
    const tool = createMaintenanceDeleteTool();
    expect(tool.name).toBe("maintenance.delete");
    expect(tool.effect).toBe("destructive");
    expect(tool.requiredAccessRules).toEqual([
      "maintenance.maintenance.manage",
    ]);
    expect(typeof tool.dryRun).toBe("function");
  });

  test("dryRun resolves the target and NEVER deletes", async () => {
    const getMaintenance = mock(() => Promise.resolve(maintenance));
    const deleteMaintenance = mock(() => Promise.resolve());
    const rpcClient = fakeRpcClient({ getMaintenance, deleteMaintenance });
    const tool = createMaintenanceDeleteTool();
    const preview = await tool.dryRun!({
      input: { id: "m1" },
      principal,
      rpcClient,
    });
    expect(deleteMaintenance).not.toHaveBeenCalled();
    expect(preview.summary).toContain("DB upgrade");
    expect(preview.summary).toContain("permanent");
    expect(preview.payload).toEqual({ id: "m1" });
  });

  test("dryRun throws a clear error when the id is unknown", async () => {
    const rpcClient = fakeRpcClient({
      getMaintenance: mock(() => Promise.resolve(null)),
      deleteMaintenance: mock(),
    });
    const tool = createMaintenanceDeleteTool();
    await expect(
      tool.dryRun!({ input: { id: "nope" }, principal, rpcClient }),
    ).rejects.toThrow(/No maintenance found/);
  });

  test("execute (apply) deletes via deleteMaintenance", async () => {
    const deleteMaintenance = mock(() => Promise.resolve({ success: true }));
    const rpcClient = fakeRpcClient({
      getMaintenance: mock(() => Promise.resolve(maintenance)),
      deleteMaintenance,
    });
    const tool = createMaintenanceDeleteTool();
    const result = await tool.execute({
      input: { id: "m1" },
      principal,
      rpcClient,
    });
    expect(deleteMaintenance).toHaveBeenCalledWith({ id: "m1" });
    expect(result).toEqual({ id: "m1", deleted: true });
  });
});
