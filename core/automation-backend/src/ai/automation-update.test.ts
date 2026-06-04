import { describe, expect, test, mock } from "bun:test";
import type { AuthUser, RpcClient } from "@checkstack/backend-api";
import { createAutomationUpdateTool } from "./automation-update";

const principal: AuthUser = {
  type: "user",
  id: "u1",
  accessRules: ["automation.automation.manage"],
};

const existing = { id: "a1", name: "Page on-call" };

const definition = {
  name: "Auto incident on outage",
  triggers: [{ event: "incident.incident.created" }],
  conditions: [],
  actions: [],
  mode: "single" as const,
  concurrency_scope: "automation" as const,
  max_runs: 10,
};

function fakeRpcClient(overrides: Record<string, ReturnType<typeof mock>>): {
  rpcClient: RpcClient;
  fns: Record<string, ReturnType<typeof mock>>;
} {
  const fns = {
    getAutomation: mock(() => Promise.resolve(existing)),
    validateDefinition: mock(() => Promise.resolve({ valid: true, errors: [] })),
    updateAutomation: mock(() => Promise.resolve({ ...existing, name: "new" })),
    ...overrides,
  };
  return {
    rpcClient: { forPlugin: () => fns } as unknown as RpcClient,
    fns,
  };
}

describe("automation.update tool", () => {
  test("declares mutate effect + the manage rule", () => {
    const tool = createAutomationUpdateTool();
    expect(tool.name).toBe("automation.update");
    expect(tool.effect).toBe("mutate");
    expect(tool.requiredAccessRules).toEqual(["automation.automation.manage"]);
  });

  test("dryRun validates a provided definition and NEVER updates", async () => {
    const { rpcClient, fns } = fakeRpcClient({});
    const tool = createAutomationUpdateTool();
    const preview = await tool.dryRun!({
      input: { id: "a1", definition },
      principal,
      rpcClient,
    });
    expect(fns.validateDefinition).toHaveBeenCalledTimes(1);
    expect(fns.updateAutomation).not.toHaveBeenCalled();
    expect(preview.summary).toContain("Page on-call");
  });

  test("dryRun skips validation when no definition is provided", async () => {
    const { rpcClient, fns } = fakeRpcClient({});
    const tool = createAutomationUpdateTool();
    await tool.dryRun!({
      input: { id: "a1", name: "Renamed" },
      principal,
      rpcClient,
    });
    expect(fns.validateDefinition).not.toHaveBeenCalled();
  });

  test("dryRun surfaces an invalid definition error", async () => {
    const { rpcClient } = fakeRpcClient({
      validateDefinition: mock(() =>
        Promise.resolve({
          valid: false,
          errors: [{ path: ["actions", 0], message: "Unknown action" }],
        }),
      ),
    });
    const tool = createAutomationUpdateTool();
    await expect(
      tool.dryRun!({ input: { id: "a1", definition }, principal, rpcClient }),
    ).rejects.toThrow(/invalid/i);
  });

  test("execute (apply) updates via updateAutomation", async () => {
    const { rpcClient, fns } = fakeRpcClient({});
    const tool = createAutomationUpdateTool();
    const result = await tool.execute({
      input: { id: "a1", name: "Renamed" },
      principal,
      rpcClient,
    });
    expect(fns.updateAutomation).toHaveBeenCalledWith({ id: "a1", name: "Renamed" });
    expect(result.automation.id).toBe("a1");
  });
});
