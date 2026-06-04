import { describe, expect, test, mock } from "bun:test";
import type { AuthUser, RpcClient } from "@checkstack/backend-api";
import { createAutomationProposeTool } from "./automation-propose";

const principal: AuthUser = {
  type: "user",
  id: "u1",
  accessRules: ["automation.automation.manage"],
};

const validDefinition = {
  name: "Auto incident on outage",
  triggers: [{ event: "incident.incident.created" }],
  conditions: [],
  actions: [],
  mode: "single" as const,
  concurrency_scope: "automation" as const,
  max_runs: 10,
};

function fakeRpcClient({
  validateDefinition,
  createAutomation,
}: {
  validateDefinition: ReturnType<typeof mock>;
  createAutomation: ReturnType<typeof mock>;
}): RpcClient {
  return {
    forPlugin: () => ({ validateDefinition, createAutomation }),
  } as unknown as RpcClient;
}

describe("automation.propose composite tool", () => {
  test("declares mutate effect + automation manage rule", () => {
    const tool = createAutomationProposeTool();
    expect(tool.name).toBe("automation.propose");
    expect(tool.effect).toBe("mutate");
    expect(tool.requiredAccessRules).toEqual(["automation.automation.manage"]);
    expect(typeof tool.dryRun).toBe("function");
  });

  test("dryRun validates via validateDefinition and NEVER creates (matrix #12)", async () => {
    const validateDefinition = mock(() =>
      Promise.resolve({ valid: true, errors: [] }),
    );
    const createAutomation = mock(() => Promise.resolve({}));
    const rpcClient = fakeRpcClient({ validateDefinition, createAutomation });
    const tool = createAutomationProposeTool();

    const preview = await tool.dryRun!({
      input: { name: "My automation", definition: validDefinition, runAs: "app-test" },
      principal,
      rpcClient,
    });

    expect(validateDefinition).toHaveBeenCalledTimes(1);
    // The AI never silently creates an automation: create is NOT called at propose.
    expect(createAutomation).not.toHaveBeenCalled();
    expect(preview.summary).toContain("My automation");
    const payload = preview.payload as { name: string; yaml: string };
    expect(payload.name).toBe("My automation");
    expect(payload.yaml).toContain("definition:");
  });

  test("dryRun throws when the drafted definition is invalid", async () => {
    const validateDefinition = mock(() =>
      Promise.resolve({
        valid: false,
        errors: [{ path: ["triggers"], message: "At least one trigger" }],
      }),
    );
    const rpcClient = fakeRpcClient({
      validateDefinition,
      createAutomation: mock(),
    });
    const tool = createAutomationProposeTool();

    await expect(
      tool.dryRun!({
        input: { name: "Bad", definition: validDefinition, runAs: "app-test" },
        principal,
        rpcClient,
      }),
    ).rejects.toThrow(/invalid/i);
  });

  test("execute (apply) creates the automation via createAutomation", async () => {
    const created = {
      id: "a1",
      name: "My automation",
      status: "enabled",
      definition: validDefinition,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const createAutomation = mock(() => Promise.resolve(created));
    const rpcClient = fakeRpcClient({
      validateDefinition: mock(() =>
        Promise.resolve({ valid: true, errors: [] }),
      ),
      createAutomation,
    });
    const tool = createAutomationProposeTool();

    const result = await tool.execute({
      input: { name: "My automation", definition: validDefinition, runAs: "app-test" },
      principal,
      rpcClient,
    });
    expect(createAutomation).toHaveBeenCalledTimes(1);
    expect(result.automation.id).toBe("a1");
  });
});
