import { describe, expect, test, mock } from "bun:test";
import type { AuthUser, RpcClient } from "@checkstack/backend-api";
import type {
  CreateIncidentInput,
  IncidentWithSystems,
} from "@checkstack/incident-common";
import { createIncidentCreateTool } from "./incident-create";

const principal: AuthUser = {
  type: "user",
  id: "u1",
  accessRules: ["incident.incident.manage"],
};

const input: CreateIncidentInput = {
  title: "Checkout is down",
  severity: "critical",
  suppressNotifications: false,
  systemIds: ["sys1", "sys2"],
};

function fakeRpcClient({
  createIncident,
}: {
  createIncident: ReturnType<typeof mock>;
}): RpcClient {
  return {
    forPlugin: () => ({ createIncident }),
  } as unknown as RpcClient;
}

describe("incident.create tool", () => {
  test("declares mutate effect + the manage rule", () => {
    const tool = createIncidentCreateTool();
    expect(tool.name).toBe("incident.create");
    expect(tool.effect).toBe("mutate");
    expect(tool.requiredAccessRules).toEqual(["incident.incident.manage"]);
    expect(typeof tool.dryRun).toBe("function");
  });

  test("dryRun returns a payload and NEVER creates", async () => {
    const createIncident = mock(() => Promise.resolve({}));
    const rpcClient = fakeRpcClient({ createIncident });
    const tool = createIncidentCreateTool();
    const preview = await tool.dryRun!({ input, principal, rpcClient });
    expect(createIncident).not.toHaveBeenCalled();
    expect(preview.summary).toContain("Checkout is down");
    expect(preview.payload).toEqual(input);
  });

  test("execute (apply) creates via createIncident", async () => {
    const created: IncidentWithSystems = {
      id: "inc1",
      title: input.title,
      description: input.description,
      status: "investigating",
      severity: input.severity,
      suppressNotifications: input.suppressNotifications,
      healthOverride: null,
      systemIds: input.systemIds,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const createIncident = mock(() => Promise.resolve(created));
    const rpcClient = fakeRpcClient({ createIncident });
    const tool = createIncidentCreateTool();
    const result = await tool.execute({ input, principal, rpcClient });
    expect(createIncident).toHaveBeenCalledWith(input);
    expect(result.incident).toEqual(created);
  });
});
