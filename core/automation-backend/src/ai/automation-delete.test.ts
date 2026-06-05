import { describe, expect, test, mock } from "bun:test";
import type { AuthUser, RpcClient } from "@checkstack/backend-api";
import { createAutomationDeleteTool } from "./automation-delete";

const principal: AuthUser = {
  type: "user",
  id: "u1",
  accessRules: ["automation.automation.manage"],
};

const automation = { id: "a1", name: "Page on-call" };

function fakeRpcClient({
  getAutomation,
  deleteAutomation,
}: {
  getAutomation: ReturnType<typeof mock>;
  deleteAutomation: ReturnType<typeof mock>;
}): RpcClient {
  return {
    forPlugin: () => ({ getAutomation, deleteAutomation }),
  } as unknown as RpcClient;
}

describe("automation.delete tool", () => {
  test("declares destructive effect + the manage rule", () => {
    const tool = createAutomationDeleteTool();
    expect(tool.name).toBe("automation.delete");
    expect(tool.effect).toBe("destructive");
    expect(tool.requiredAccessRules).toEqual(["automation.automation.manage"]);
  });

  test("dryRun resolves the target and NEVER deletes", async () => {
    const deleteAutomation = mock();
    const rpcClient = fakeRpcClient({
      getAutomation: mock(() => Promise.resolve(automation)),
      deleteAutomation,
    });
    const tool = createAutomationDeleteTool();
    const preview = await tool.dryRun!({
      input: { id: "a1" },
      principal,
      rpcClient,
    });
    expect(deleteAutomation).not.toHaveBeenCalled();
    expect(preview.summary).toContain("Page on-call");
    expect(preview.payload).toEqual({ id: "a1" });
  });

  test("execute (apply) deletes via deleteAutomation", async () => {
    const deleteAutomation = mock(() => Promise.resolve({ success: true }));
    const rpcClient = fakeRpcClient({
      getAutomation: mock(() => Promise.resolve(automation)),
      deleteAutomation,
    });
    const tool = createAutomationDeleteTool();
    const result = await tool.execute({ input: { id: "a1" }, principal, rpcClient });
    expect(deleteAutomation).toHaveBeenCalledWith({ id: "a1" });
    expect(result).toEqual({ id: "a1", deleted: true });
  });
});
