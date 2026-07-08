import { describe, expect, test, mock } from "bun:test";
import type { AuthUser, RpcClient } from "@checkstack/backend-api";
import { createCatalogCreateGroupTool } from "./catalog-create-group";

const principal: AuthUser = {
  type: "user",
  id: "u1",
  accessRules: ["catalog.system.manage", "catalog.group.manage"],
};

const group = {
  id: "grp1",
  name: "Payments",
  systemIds: [],
  sortOrder: 0,
  metadata: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function fakeRpcClient({
  createGroup,
}: {
  createGroup: ReturnType<typeof mock>;
}): RpcClient {
  return {
    forPlugin: () => ({ createGroup }),
  } as unknown as RpcClient;
}

describe("catalog.createGroup tool", () => {
  test("declares mutate effect + the group manage rule", () => {
    const tool = createCatalogCreateGroupTool();
    expect(tool.name).toBe("catalog.createGroup");
    expect(tool.effect).toBe("mutate");
    expect(tool.requiredAccessRules).toEqual(["catalog.group.manage"]);
    expect(typeof tool.dryRun).toBe("function");
  });

  test("dryRun summarizes the create and NEVER creates", async () => {
    const createGroup = mock(() => Promise.resolve(group));
    const rpcClient = fakeRpcClient({ createGroup });
    const tool = createCatalogCreateGroupTool();
    const preview = await tool.dryRun!({
      input: { name: "Payments" },
      principal,
      rpcClient,
    });
    expect(createGroup).not.toHaveBeenCalled();
    expect(preview.summary).toContain("Payments");
    expect(preview.payload).toEqual({ name: "Payments" });
  });

  test("execute (apply) creates via createGroup", async () => {
    const createGroup = mock(() => Promise.resolve(group));
    const rpcClient = fakeRpcClient({ createGroup });
    const tool = createCatalogCreateGroupTool();
    const input = { name: "Payments" };
    const result = await tool.execute({ input, principal, rpcClient });
    expect(createGroup).toHaveBeenCalledWith(input);
    expect(result).toEqual({ group });
  });
});
