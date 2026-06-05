import { describe, expect, test, mock } from "bun:test";
import type { AuthUser, RpcClient } from "@checkstack/backend-api";
import { createMaintenanceRemoveLinkTool } from "./maintenance-remove-link";

const principal: AuthUser = {
  type: "user",
  id: "u1",
  accessRules: ["maintenance.maintenance.manage"],
};

function fakeRpcClient({
  removeLink,
}: {
  removeLink: ReturnType<typeof mock>;
}): RpcClient {
  return {
    forPlugin: () => ({ removeLink }),
  } as unknown as RpcClient;
}

describe("maintenance.removeLink tool", () => {
  test("declares destructive effect + the manage rule", () => {
    const tool = createMaintenanceRemoveLinkTool();
    expect(tool.name).toBe("maintenance.removeLink");
    expect(tool.effect).toBe("destructive");
    expect(tool.requiredAccessRules).toEqual([
      "maintenance.maintenance.manage",
    ]);
    expect(typeof tool.dryRun).toBe("function");
  });

  test("dryRun summarizes and NEVER removes", async () => {
    const removeLink = mock(() => Promise.resolve());
    const rpcClient = fakeRpcClient({ removeLink });
    const tool = createMaintenanceRemoveLinkTool();
    const preview = await tool.dryRun!({
      input: { id: "l1" },
      principal,
      rpcClient,
    });
    expect(removeLink).not.toHaveBeenCalled();
    expect(preview.summary).toContain("permanent");
    expect(preview.payload).toEqual({ id: "l1" });
  });

  test("execute (apply) removes via removeLink", async () => {
    const removeLink = mock(() => Promise.resolve({ success: true }));
    const rpcClient = fakeRpcClient({ removeLink });
    const tool = createMaintenanceRemoveLinkTool();
    const result = await tool.execute({
      input: { id: "l1" },
      principal,
      rpcClient,
    });
    expect(removeLink).toHaveBeenCalledWith({ id: "l1" });
    expect(result).toEqual({ id: "l1", removed: true });
  });
});
