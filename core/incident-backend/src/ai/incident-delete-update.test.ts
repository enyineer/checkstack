import { describe, expect, test, mock } from "bun:test";
import type { AuthUser, RpcClient } from "@checkstack/backend-api";
import { createIncidentDeleteUpdateTool } from "./incident-delete-update";

const principal: AuthUser = {
  type: "user",
  id: "u1",
  accessRules: ["incident.incident.manage"],
};

function fakeRpcClient({
  deleteUpdate,
}: {
  deleteUpdate: ReturnType<typeof mock>;
}): RpcClient {
  return {
    forPlugin: () => ({ deleteUpdate }),
  } as unknown as RpcClient;
}

describe("incident.deleteUpdate tool", () => {
  test("declares destructive effect + the manage rule", () => {
    const tool = createIncidentDeleteUpdateTool();
    expect(tool.name).toBe("incident.deleteUpdate");
    expect(tool.effect).toBe("destructive");
    expect(tool.requiredAccessRules).toEqual(["incident.incident.manage"]);
    expect(typeof tool.dryRun).toBe("function");
  });

  test("dryRun returns a payload and NEVER deletes the update", async () => {
    const deleteUpdate = mock(() => Promise.resolve({ success: true }));
    const rpcClient = fakeRpcClient({ deleteUpdate });
    const tool = createIncidentDeleteUpdateTool();
    const preview = await tool.dryRun!({
      input: { id: "upd1", incidentId: "inc1" },
      principal,
      rpcClient,
    });
    expect(deleteUpdate).not.toHaveBeenCalled();
    expect(preview.summary).toContain("permanent");
    expect(preview.payload).toEqual({ id: "upd1", incidentId: "inc1" });
  });

  test("execute (apply) deletes via deleteUpdate with {id, incidentId}", async () => {
    const deleteUpdate = mock(() => Promise.resolve({ success: true }));
    const rpcClient = fakeRpcClient({ deleteUpdate });
    const tool = createIncidentDeleteUpdateTool();
    const result = await tool.execute({
      input: { id: "upd1", incidentId: "inc1" },
      principal,
      rpcClient,
    });
    expect(deleteUpdate).toHaveBeenCalledWith({
      id: "upd1",
      incidentId: "inc1",
    });
    expect(result).toEqual({ id: "upd1", removed: true });
  });
});
