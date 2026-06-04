import { describe, expect, test, mock } from "bun:test";
import type { AuthUser, RpcClient } from "@checkstack/backend-api";
import { createIncidentDeleteTool } from "./incident-delete";

const principal: AuthUser = {
  type: "user",
  id: "u1",
  accessRules: ["incident.incident.manage"],
};

const incident = {
  id: "inc1",
  title: "Checkout is down",
  description: undefined,
  status: "investigating",
  severity: "critical",
  suppressNotifications: false,
  systemIds: ["sys1"],
  createdAt: new Date(),
  updatedAt: new Date(),
  updates: [],
  links: [],
};

function fakeRpcClient({
  getIncident,
  deleteIncident,
}: {
  getIncident: ReturnType<typeof mock>;
  deleteIncident: ReturnType<typeof mock>;
}): RpcClient {
  return {
    forPlugin: () => ({ getIncident, deleteIncident }),
  } as unknown as RpcClient;
}

describe("incident.delete tool", () => {
  test("declares destructive effect + the manage rule", () => {
    const tool = createIncidentDeleteTool();
    expect(tool.name).toBe("incident.delete");
    expect(tool.effect).toBe("destructive");
    expect(tool.requiredAccessRules).toEqual(["incident.incident.manage"]);
    expect(typeof tool.dryRun).toBe("function");
  });

  test("dryRun resolves the target and NEVER deletes", async () => {
    const getIncident = mock(() => Promise.resolve(incident));
    const deleteIncident = mock(() => Promise.resolve({ success: true }));
    const rpcClient = fakeRpcClient({ getIncident, deleteIncident });
    const tool = createIncidentDeleteTool();
    const preview = await tool.dryRun!({
      input: { id: "inc1" },
      principal,
      rpcClient,
    });
    expect(deleteIncident).not.toHaveBeenCalled();
    expect(preview.summary).toContain("Checkout is down");
    expect(preview.summary).toContain("permanent");
    expect(preview.payload).toEqual({ id: "inc1" });
  });

  test("dryRun throws a clear error when the id is unknown", async () => {
    const rpcClient = fakeRpcClient({
      getIncident: mock(() => Promise.resolve(null)),
      deleteIncident: mock(),
    });
    const tool = createIncidentDeleteTool();
    await expect(
      tool.dryRun!({ input: { id: "nope" }, principal, rpcClient }),
    ).rejects.toThrow(/No incident found/);
  });

  test("execute (apply) deletes via deleteIncident with {id}", async () => {
    const deleteIncident = mock(() => Promise.resolve({ success: true }));
    const rpcClient = fakeRpcClient({
      getIncident: mock(() => Promise.resolve(incident)),
      deleteIncident,
    });
    const tool = createIncidentDeleteTool();
    const result = await tool.execute({
      input: { id: "inc1" },
      principal,
      rpcClient,
    });
    expect(deleteIncident).toHaveBeenCalledWith({ id: "inc1" });
    expect(result).toEqual({ id: "inc1", deleted: true });
  });
});
