import { describe, expect, test, mock } from "bun:test";
import type { AuthUser, RpcClient } from "@checkstack/backend-api";
import type { IncidentWithSystems } from "@checkstack/incident-common";
import { createIncidentResolveTool } from "./incident-resolve";

const principal: AuthUser = {
  type: "user",
  id: "u1",
  accessRules: ["incident.incident.manage"],
};

const input = { id: "inc1", message: "All clear" };

function fakeRpcClient({
  resolveIncident,
}: {
  resolveIncident: ReturnType<typeof mock>;
}): RpcClient {
  return {
    forPlugin: () => ({ resolveIncident }),
  } as unknown as RpcClient;
}

describe("incident.resolve tool", () => {
  test("declares mutate effect + the manage rule", () => {
    const tool = createIncidentResolveTool();
    expect(tool.name).toBe("incident.resolve");
    expect(tool.effect).toBe("mutate");
    expect(tool.requiredAccessRules).toEqual(["incident.incident.manage"]);
    expect(typeof tool.dryRun).toBe("function");
  });

  test("dryRun returns a payload and NEVER resolves", async () => {
    const resolveIncident = mock(() => Promise.resolve({}));
    const rpcClient = fakeRpcClient({ resolveIncident });
    const tool = createIncidentResolveTool();
    const preview = await tool.dryRun!({ input, principal, rpcClient });
    expect(resolveIncident).not.toHaveBeenCalled();
    expect(preview.summary).toContain("inc1");
    expect(preview.payload).toEqual(input);
  });

  test("execute (apply) resolves via resolveIncident", async () => {
    const resolved: IncidentWithSystems = {
      id: "inc1",
      title: "Checkout is down",
      status: "resolved",
      severity: "critical",
      suppressNotifications: false,
      systemIds: ["sys1"],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const resolveIncident = mock(() => Promise.resolve(resolved));
    const rpcClient = fakeRpcClient({ resolveIncident });
    const tool = createIncidentResolveTool();
    const result = await tool.execute({ input, principal, rpcClient });
    expect(resolveIncident).toHaveBeenCalledWith(input);
    expect(result.incident).toEqual(resolved);
  });
});
