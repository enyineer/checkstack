import { describe, expect, test, mock } from "bun:test";
import type { AuthUser, RpcClient } from "@checkstack/backend-api";
import { createCatalogSetSystemEnvironmentsTool } from "./catalog-set-system-environments";

const principal: AuthUser = {
  type: "user",
  id: "u1",
  accessRules: ["catalog.environment.manage", "catalog.system.manage"],
};

function fakeRpcClient({
  setSystemEnvironments,
}: {
  setSystemEnvironments: ReturnType<typeof mock>;
}): RpcClient {
  return {
    forPlugin: () => ({ setSystemEnvironments }),
  } as unknown as RpcClient;
}

describe("catalog.setSystemEnvironments tool", () => {
  test("declares mutate effect + the environment manage rule", () => {
    const tool = createCatalogSetSystemEnvironmentsTool();
    expect(tool.name).toBe("catalog.setSystemEnvironments");
    expect(tool.effect).toBe("mutate");
    expect(tool.requiredAccessRules).toEqual(["catalog.environment.manage"]);
    expect(typeof tool.dryRun).toBe("function");
  });

  test("dryRun summarizes the desired set and NEVER mutates", async () => {
    const setSystemEnvironments = mock(() =>
      Promise.resolve({ success: true }),
    );
    const rpcClient = fakeRpcClient({ setSystemEnvironments });
    const tool = createCatalogSetSystemEnvironmentsTool();
    const preview = await tool.dryRun!({
      input: { systemId: "sys1", environmentIds: ["e1", "e2"] },
      principal,
      rpcClient,
    });
    expect(setSystemEnvironments).not.toHaveBeenCalled();
    expect(preview.summary).toContain("2 environments");
    expect(preview.payload).toEqual({
      systemId: "sys1",
      environmentIds: ["e1", "e2"],
    });
  });

  test("execute (apply) sets the membership via setSystemEnvironments", async () => {
    const setSystemEnvironments = mock(() =>
      Promise.resolve({ success: true }),
    );
    const rpcClient = fakeRpcClient({ setSystemEnvironments });
    const tool = createCatalogSetSystemEnvironmentsTool();
    const input = { systemId: "sys1", environmentIds: ["e1"] };
    const result = await tool.execute({ input, principal, rpcClient });
    expect(setSystemEnvironments).toHaveBeenCalledWith(input);
    expect(result).toEqual({ success: true });
  });
});
