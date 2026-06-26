import { describe, expect, test, mock } from "bun:test";
import type { AuthUser, RpcClient } from "@checkstack/backend-api";
import { createCatalogCreateEnvironmentTool } from "./catalog-create-environment";

const principal: AuthUser = {
  type: "user",
  id: "u1",
  accessRules: ["catalog.environment.manage"],
};

const environment = {
  id: "env1",
  name: "production",
  description: "Prod",
  systemIds: [],
  metadata: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function fakeRpcClient({
  createEnvironment,
}: {
  createEnvironment: ReturnType<typeof mock>;
}): RpcClient {
  return {
    forPlugin: () => ({ createEnvironment }),
  } as unknown as RpcClient;
}

describe("catalog.createEnvironment tool", () => {
  test("declares mutate effect + the environment manage rule", () => {
    const tool = createCatalogCreateEnvironmentTool();
    expect(tool.name).toBe("catalog.createEnvironment");
    expect(tool.effect).toBe("mutate");
    expect(tool.requiredAccessRules).toEqual(["catalog.environment.manage"]);
    expect(typeof tool.dryRun).toBe("function");
  });

  test("dryRun summarizes the create and NEVER creates", async () => {
    const createEnvironment = mock(() => Promise.resolve(environment));
    const rpcClient = fakeRpcClient({ createEnvironment });
    const tool = createCatalogCreateEnvironmentTool();
    const preview = await tool.dryRun!({
      input: { name: "production" },
      principal,
      rpcClient,
    });
    expect(createEnvironment).not.toHaveBeenCalled();
    expect(preview.summary).toContain("production");
    expect(preview.payload).toEqual({ name: "production" });
  });

  test("execute (apply) creates via createEnvironment", async () => {
    const createEnvironment = mock(() => Promise.resolve(environment));
    const rpcClient = fakeRpcClient({ createEnvironment });
    const tool = createCatalogCreateEnvironmentTool();
    const input = { name: "production", description: "Prod" };
    const result = await tool.execute({ input, principal, rpcClient });
    expect(createEnvironment).toHaveBeenCalledWith(input);
    expect(result).toEqual({ environment });
  });
});
