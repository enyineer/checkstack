import { describe, expect, test, mock } from "bun:test";
import type { AuthUser, RpcClient } from "@checkstack/backend-api";
import { createCatalogCreateSystemTool } from "./catalog-create-system";

const principal: AuthUser = {
  type: "user",
  id: "u1",
  accessRules: ["catalog.system.manage", "catalog.group.manage"],
};

const system = {
  id: "sys1",
  name: "Checkout API",
  description: "Handles checkout",
  metadata: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function fakeRpcClient({
  createSystem,
}: {
  createSystem: ReturnType<typeof mock>;
}): RpcClient {
  return {
    forPlugin: () => ({ createSystem }),
  } as unknown as RpcClient;
}

describe("catalog.createSystem tool", () => {
  test("declares mutate effect + the system manage rule", () => {
    const tool = createCatalogCreateSystemTool();
    expect(tool.name).toBe("catalog.createSystem");
    expect(tool.effect).toBe("mutate");
    expect(tool.requiredAccessRules).toEqual(["catalog.system.manage"]);
    expect(typeof tool.dryRun).toBe("function");
  });

  test("dryRun summarizes the create and NEVER creates", async () => {
    const createSystem = mock(() => Promise.resolve(system));
    const rpcClient = fakeRpcClient({ createSystem });
    const tool = createCatalogCreateSystemTool();
    const preview = await tool.dryRun!({
      input: { name: "Checkout API" },
      principal,
      rpcClient,
    });
    expect(createSystem).not.toHaveBeenCalled();
    expect(preview.summary).toContain("Checkout API");
    expect(preview.payload).toEqual({ name: "Checkout API" });
  });

  test("execute (apply) creates via createSystem", async () => {
    const createSystem = mock(() => Promise.resolve(system));
    const rpcClient = fakeRpcClient({ createSystem });
    const tool = createCatalogCreateSystemTool();
    const input = { name: "Checkout API", description: "Handles checkout" };
    const result = await tool.execute({ input, principal, rpcClient });
    expect(createSystem).toHaveBeenCalledWith(input);
    expect(result).toEqual({ system });
  });
});
