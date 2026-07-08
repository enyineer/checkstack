import { describe, expect, test, mock } from "bun:test";
import type { AuthUser, RpcClient } from "@checkstack/backend-api";
import type { AddIncidentUpdateInput } from "@checkstack/incident-common";
import { createIncidentAddUpdateTool } from "./incident-add-update";

const principal: AuthUser = {
  type: "user",
  id: "u1",
  accessRules: ["incident.incident.manage"],
};

const input: AddIncidentUpdateInput = {
  incidentId: "inc1",
  message: "We identified the root cause",
  statusChange: "identified",
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

describe("incident.addUpdate tool", () => {
  test("declares mutate effect + the manage rule", () => {
    const tool = createIncidentAddUpdateTool();
    expect(tool.name).toBe("incident.addUpdate");
    expect(tool.effect).toBe("mutate");
    expect(tool.requiredAccessRules).toEqual(["incident.incident.manage"]);
    expect(typeof tool.dryRun).toBe("function");
  });

  test("dryRun returns a payload and NEVER posts the update", async () => {
    const addUpdate = mock(() => Promise.resolve({}));
    const rpcClient = fakeRpcClient({ addUpdate });
    const tool = createIncidentAddUpdateTool();
    const preview = await tool.dryRun!({ input, principal, rpcClient });
    expect(addUpdate).not.toHaveBeenCalled();
    expect(preview.summary).toContain("identified");
    expect(preview.payload).toEqual(input);
  });

  test("execute (apply) posts via addUpdate", async () => {
    const created = {
      id: "upd1",
      ...input,
      visibility: "public" as const,
      createdAt: new Date(),
    };
    const addUpdate = mock(() => Promise.resolve(created));
    const rpcClient = fakeRpcClient({ addUpdate });
    const tool = createIncidentAddUpdateTool();
    const result = await tool.execute({ input, principal, rpcClient });
    expect(addUpdate).toHaveBeenCalledWith(input);
    expect(result.update).toEqual(created);
  });
});
