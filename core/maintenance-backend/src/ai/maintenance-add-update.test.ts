import { describe, expect, test, mock } from "bun:test";
import type { AuthUser, RpcClient } from "@checkstack/backend-api";
import { createMaintenanceAddUpdateTool } from "./maintenance-add-update";

const principal: AuthUser = {
  type: "user",
  id: "u1",
  accessRules: ["maintenance.maintenance.manage"],
};

function fakeRpcClient({
  addUpdate,
}: {
  addUpdate: ReturnType<typeof mock>;
}): RpcClient {
  return {
    forPlugin: () => ({ addUpdate }),
  } as unknown as RpcClient;
}

describe("maintenance.addUpdate tool", () => {
  test("declares mutate effect + the manage rule", () => {
    const tool = createMaintenanceAddUpdateTool();
    expect(tool.name).toBe("maintenance.addUpdate");
    expect(tool.effect).toBe("mutate");
    expect(tool.requiredAccessRules).toEqual([
      "maintenance.maintenance.manage",
    ]);
    expect(typeof tool.dryRun).toBe("function");
  });

  test("dryRun summarizes without posting", async () => {
    const addUpdate = mock(() => Promise.resolve());
    const rpcClient = fakeRpcClient({ addUpdate });
    const tool = createMaintenanceAddUpdateTool();
    const preview = await tool.dryRun!({
      input: { maintenanceId: "m1", message: "Patching now" },
      principal,
      rpcClient,
    });
    expect(addUpdate).not.toHaveBeenCalled();
    expect(preview.summary).toContain("Patching now");
  });

  test("execute posts via addUpdate", async () => {
    const addUpdate = mock(() =>
      Promise.resolve({ id: "u1", maintenanceId: "m1", message: "Patching now" }),
    );
    const rpcClient = fakeRpcClient({ addUpdate });
    const tool = createMaintenanceAddUpdateTool();
    const result = await tool.execute({
      input: {
        maintenanceId: "m1",
        message: "Patching now",
        statusChange: "in_progress",
      },
      principal,
      rpcClient,
    });
    expect(addUpdate).toHaveBeenCalledWith({
      maintenanceId: "m1",
      message: "Patching now",
      statusChange: "in_progress",
    });
    expect(result.update.id).toBe("u1");
  });
});
