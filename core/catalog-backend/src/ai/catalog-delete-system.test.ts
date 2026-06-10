import { describe, expect, test, mock } from "bun:test";
import type { AuthUser, RpcClient } from "@checkstack/backend-api";
import { createCatalogDeleteSystemTool } from "./catalog-delete-system";

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
  deleteSystem,
}: {
  getSystem: ReturnType<typeof mock>;
  deleteSystem: ReturnType<typeof mock>;
}): RpcClient {
  return {
    forPlugin: () => ({ getSystem, deleteSystem }),
  } as unknown as RpcClient;
}

describe("catalog.deleteSystem tool", () => {
  test("declares destructive effect + the system manage rule", () => {
    const tool = createCatalogDeleteSystemTool();
    expect(tool.name).toBe("catalog.deleteSystem");
    expect(tool.effect).toBe("destructive");
    expect(tool.requiredAccessRules).toEqual(["catalog.system.manage"]);
    expect(typeof tool.dryRun).toBe("function");
  });

  test("dryRun resolves the target and NEVER deletes", async () => {
    const getSystem = mock(() => Promise.resolve(system));
    const deleteSystem = mock(() => Promise.resolve({ success: true }));
    const rpcClient = fakeRpcClient({ getSystem, deleteSystem });
    const tool = createCatalogDeleteSystemTool();
    const preview = await tool.dryRun!({
      input: { id: "sys1" },
      principal,
      rpcClient,
    });
    expect(getSystem).toHaveBeenCalledWith({ systemId: "sys1" });
    expect(deleteSystem).not.toHaveBeenCalled();
    expect(preview.summary).toContain("Checkout API");
    expect(preview.summary).toContain("permanent");
    expect(preview.payload).toEqual({ id: "sys1" });
  });

  test("dryRun throws a clear error when the id is unknown", async () => {
    const rpcClient = fakeRpcClient({
      getSystem: mock(() => Promise.resolve(null)),
      deleteSystem: mock(),
    });
    const tool = createCatalogDeleteSystemTool();
    await expect(
      tool.dryRun!({ input: { id: "nope" }, principal, rpcClient }),
    ).rejects.toThrow(/No system found/);
  });

  test("execute (apply) deletes via deleteSystem with an { id } payload", async () => {
    const deleteSystem = mock(() => Promise.resolve({ success: true }));
    const rpcClient = fakeRpcClient({
      getSystem: mock(() => Promise.resolve(system)),
      deleteSystem,
    });
    const tool = createCatalogDeleteSystemTool();
    const result = await tool.execute({
      input: { id: "sys1" },
      principal,
      rpcClient,
    });
    expect(deleteSystem).toHaveBeenCalledWith({ id: "sys1" });
    expect(result).toEqual({ id: "sys1", deleted: true });
  });
});
