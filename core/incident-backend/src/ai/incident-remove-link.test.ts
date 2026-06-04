import { describe, expect, test, mock } from "bun:test";
import type { AuthUser, RpcClient } from "@checkstack/backend-api";
import { createIncidentRemoveLinkTool } from "./incident-remove-link";

const principal: AuthUser = {
  type: "user",
  id: "u1",
  accessRules: ["incident.incident.manage"],
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

describe("incident.removeLink tool", () => {
  test("declares destructive effect + the manage rule", () => {
    const tool = createIncidentRemoveLinkTool();
    expect(tool.name).toBe("incident.removeLink");
    expect(tool.effect).toBe("destructive");
    expect(tool.requiredAccessRules).toEqual(["incident.incident.manage"]);
    expect(typeof tool.dryRun).toBe("function");
  });

  test("dryRun returns a payload and NEVER removes the link", async () => {
    const removeLink = mock(() => Promise.resolve({ success: true }));
    const rpcClient = fakeRpcClient({ removeLink });
    const tool = createIncidentRemoveLinkTool();
    const preview = await tool.dryRun!({
      input: { id: "lnk1" },
      principal,
      rpcClient,
    });
    expect(removeLink).not.toHaveBeenCalled();
    expect(preview.summary).toContain("permanent");
    expect(preview.payload).toEqual({ id: "lnk1" });
  });

  test("execute (apply) removes via removeLink with {id}", async () => {
    const removeLink = mock(() => Promise.resolve({ success: true }));
    const rpcClient = fakeRpcClient({ removeLink });
    const tool = createIncidentRemoveLinkTool();
    const result = await tool.execute({
      input: { id: "lnk1" },
      principal,
      rpcClient,
    });
    expect(removeLink).toHaveBeenCalledWith({ id: "lnk1" });
    expect(result).toEqual({ id: "lnk1", removed: true });
  });
});
