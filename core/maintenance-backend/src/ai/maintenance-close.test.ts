import { describe, expect, test, mock } from "bun:test";
import type { AuthUser, RpcClient } from "@checkstack/backend-api";
import { createMaintenanceCloseTool } from "./maintenance-close";

const principal: AuthUser = {
  type: "user",
  id: "u1",
  accessRules: ["maintenance.maintenance.manage"],
};

function fakeRpcClient({
  closeMaintenance,
}: {
  closeMaintenance: ReturnType<typeof mock>;
}): RpcClient {
  return {
    forPlugin: () => ({ closeMaintenance }),
  } as unknown as RpcClient;
}

describe("maintenance.close tool", () => {
  test("declares mutate effect + the manage rule", () => {
    const tool = createMaintenanceCloseTool();
    expect(tool.name).toBe("maintenance.close");
    expect(tool.effect).toBe("mutate");
    expect(tool.requiredAccessRules).toEqual([
      "maintenance.maintenance.manage",
    ]);
    expect(typeof tool.dryRun).toBe("function");
  });

  test("dryRun summarizes without closing", async () => {
    const closeMaintenance = mock(() => Promise.resolve());
    const rpcClient = fakeRpcClient({ closeMaintenance });
    const tool = createMaintenanceCloseTool();
    const preview = await tool.dryRun!({
      input: { id: "m1", message: "Done early" },
      principal,
      rpcClient,
    });
    expect(closeMaintenance).not.toHaveBeenCalled();
    expect(preview.summary).toContain("Done early");
  });

  test("execute closes via closeMaintenance", async () => {
    const closeMaintenance = mock(() =>
      Promise.resolve({ id: "m1", systemIds: ["s1"] }),
    );
    const rpcClient = fakeRpcClient({ closeMaintenance });
    const tool = createMaintenanceCloseTool();
    const result = await tool.execute({
      input: { id: "m1", message: "Done early" },
      principal,
      rpcClient,
    });
    expect(closeMaintenance).toHaveBeenCalledWith({
      id: "m1",
      message: "Done early",
    });
    expect(result.maintenance.id).toBe("m1");
  });
});
