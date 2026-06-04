import { describe, expect, test, mock } from "bun:test";
import type { AuthUser, RpcClient } from "@checkstack/backend-api";
import { createCatalogUpdateSystemTool } from "./catalog-update-system";

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
  getSystem,
  updateSystem,
}: {
  getSystem: ReturnType<typeof mock>;
  updateSystem: ReturnType<typeof mock>;
}): RpcClient {
  return {
    forPlugin: () => ({ getSystem, updateSystem }),
  } as unknown as RpcClient;
}

describe("catalog.updateSystem tool", () => {
  test("declares mutate effect + the system manage rule", () => {
    const tool = createCatalogUpdateSystemTool();
    expect(tool.name).toBe("catalog.updateSystem");
    expect(tool.effect).toBe("mutate");
    expect(tool.requiredAccessRules).toEqual(["catalog.system.manage"]);
    expect(typeof tool.dryRun).toBe("function");
  });

  test("dryRun fetches via getSystem with the systemId key + returns a diff", async () => {
    const getSystem = mock(() => Promise.resolve(system));
    const updateSystem = mock(() => Promise.resolve(system));
    const rpcClient = fakeRpcClient({ getSystem, updateSystem });
    const tool = createCatalogUpdateSystemTool();
    const preview = await tool.dryRun!({
      input: { id: "sys1", data: { name: "Checkout" } },
      principal,
      rpcClient,
    });
    // systemId-key trap: the contract's getSystem input is { systemId }.
    expect(getSystem).toHaveBeenCalledWith({ systemId: "sys1" });
    expect(updateSystem).not.toHaveBeenCalled();
    expect(preview.summary).toContain("Checkout API");
    expect(preview.diff).toEqual([
      { path: "name", before: "Checkout API", after: "Checkout" },
    ]);
  });

  test("dryRun throws a clear error when the id is unknown", async () => {
    const rpcClient = fakeRpcClient({
      getSystem: mock(() => Promise.resolve(null)),
      updateSystem: mock(),
    });
    const tool = createCatalogUpdateSystemTool();
    await expect(
      tool.dryRun!({
        input: { id: "nope", data: { name: "x" } },
        principal,
        rpcClient,
      }),
    ).rejects.toThrow(/No system found/);
  });

  test("execute (apply) updates via updateSystem", async () => {
    const updateSystem = mock(() => Promise.resolve(system));
    const rpcClient = fakeRpcClient({
      getSystem: mock(() => Promise.resolve(system)),
      updateSystem,
    });
    const tool = createCatalogUpdateSystemTool();
    const input = { id: "sys1", data: { name: "Checkout" } };
    const result = await tool.execute({ input, principal, rpcClient });
    expect(updateSystem).toHaveBeenCalledWith(input);
    expect(result).toEqual({ system });
  });
});
