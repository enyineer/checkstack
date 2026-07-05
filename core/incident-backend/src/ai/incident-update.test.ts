import { describe, expect, test, mock } from "bun:test";
import type { AuthUser, RpcClient } from "@checkstack/backend-api";
import type { IncidentDetail } from "@checkstack/incident-common";
import { createIncidentUpdateTool } from "./incident-update";

const principal: AuthUser = {
  type: "user",
  id: "u1",
  accessRules: ["incident.incident.manage"],
};

const existing: IncidentDetail = {
  id: "inc1",
  title: "Old title",
  description: "old desc",
  status: "investigating",
  severity: "minor",
  suppressNotifications: false,
  healthOverride: null,
  systemIds: ["sys1"],
  createdAt: new Date(),
  updatedAt: new Date(),
  updates: [],
  links: [],
};

function fakeRpcClient({
  getIncident,
  updateIncident,
}: {
  getIncident: ReturnType<typeof mock>;
  updateIncident: ReturnType<typeof mock>;
}): RpcClient {
  return {
    forPlugin: () => ({ getIncident, updateIncident }),
  } as unknown as RpcClient;
}

describe("incident.update tool", () => {
  test("declares mutate effect + the manage rule", () => {
    const tool = createIncidentUpdateTool();
    expect(tool.name).toBe("incident.update");
    expect(tool.effect).toBe("mutate");
    expect(tool.requiredAccessRules).toEqual(["incident.incident.manage"]);
    expect(typeof tool.dryRun).toBe("function");
  });

  test("dryRun fetches existing, returns a diff, and NEVER updates", async () => {
    const getIncident = mock(() => Promise.resolve(existing));
    const updateIncident = mock(() => Promise.resolve(existing));
    const rpcClient = fakeRpcClient({ getIncident, updateIncident });
    const tool = createIncidentUpdateTool();
    const preview = await tool.dryRun!({
      input: { id: "inc1", severity: "critical" },
      principal,
      rpcClient,
    });
    expect(getIncident).toHaveBeenCalledWith({ id: "inc1" });
    expect(updateIncident).not.toHaveBeenCalled();
    expect(preview.diff).toBeDefined();
    expect(preview.summary).toContain("critical");
  });

  test("dryRun throws a clear error when the id is unknown", async () => {
    const rpcClient = fakeRpcClient({
      getIncident: mock(() => Promise.resolve(null)),
      updateIncident: mock(),
    });
    const tool = createIncidentUpdateTool();
    await expect(
      tool.dryRun!({ input: { id: "nope" }, principal, rpcClient }),
    ).rejects.toThrow(/No incident found/);
  });

  test("execute (apply) updates via updateIncident", async () => {
    const input = { id: "inc1", title: "New title" };
    const updated = { ...existing, title: "New title" };
    const updateIncident = mock(() => Promise.resolve(updated));
    const rpcClient = fakeRpcClient({
      getIncident: mock(() => Promise.resolve(existing)),
      updateIncident,
    });
    const tool = createIncidentUpdateTool();
    const result = await tool.execute({ input, principal, rpcClient });
    expect(updateIncident).toHaveBeenCalledWith(input);
    expect(result.incident).toEqual(updated);
  });
});
