import { describe, expect, test, mock } from "bun:test";
import type { AuthUser, RpcClient } from "@checkstack/backend-api";
import type { AddIncidentLinkInput } from "@checkstack/incident-common";
import { createIncidentAddLinkTool } from "./incident-add-link";

const principal: AuthUser = {
  type: "user",
  id: "u1",
  accessRules: ["incident.incident.manage"],
};

const input: AddIncidentLinkInput = {
  incidentId: "inc1",
  label: "Runbook",
  url: "https://example.com/runbook",
};

function fakeRpcClient({
  addLink,
}: {
  addLink: ReturnType<typeof mock>;
}): RpcClient {
  return {
    forPlugin: () => ({ addLink }),
  } as unknown as RpcClient;
}

describe("incident.addLink tool", () => {
  test("declares mutate effect + the manage rule", () => {
    const tool = createIncidentAddLinkTool();
    expect(tool.name).toBe("incident.addLink");
    expect(tool.effect).toBe("mutate");
    expect(tool.requiredAccessRules).toEqual(["incident.incident.manage"]);
    expect(typeof tool.dryRun).toBe("function");
  });

  test("dryRun returns a payload and NEVER adds the link", async () => {
    const addLink = mock(() => Promise.resolve({}));
    const rpcClient = fakeRpcClient({ addLink });
    const tool = createIncidentAddLinkTool();
    const preview = await tool.dryRun!({ input, principal, rpcClient });
    expect(addLink).not.toHaveBeenCalled();
    expect(preview.summary).toContain("Runbook");
    expect(preview.payload).toEqual(input);
  });

  test("execute (apply) adds via addLink", async () => {
    const created = {
      id: "lnk1",
      incidentId: input.incidentId,
      label: input.label ?? null,
      url: input.url,
      visibility: "public" as const,
      createdAt: new Date(),
    };
    const addLink = mock(() => Promise.resolve(created));
    const rpcClient = fakeRpcClient({ addLink });
    const tool = createIncidentAddLinkTool();
    const result = await tool.execute({ input, principal, rpcClient });
    expect(addLink).toHaveBeenCalledWith(input);
    expect(result.link).toEqual(created);
  });
});
