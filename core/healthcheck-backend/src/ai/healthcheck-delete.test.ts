import { describe, expect, test, mock } from "bun:test";
import type { AuthUser, RpcClient } from "@checkstack/backend-api";
import { createHealthcheckDeleteTool } from "./healthcheck-delete";

const principal: AuthUser = {
  type: "user",
  id: "u1",
  accessRules: ["healthcheck.healthcheck.manage"],
};

const config = {
  id: "hc1",
  name: "google-com-http",
  strategyId: "healthcheck-http.http",
  config: {},
  intervalSeconds: 60,
  paused: false,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function fakeRpcClient({
  getConfiguration,
  deleteConfiguration,
}: {
  getConfiguration: ReturnType<typeof mock>;
  deleteConfiguration: ReturnType<typeof mock>;
}): RpcClient {
  return {
    forPlugin: () => ({ getConfiguration, deleteConfiguration }),
  } as unknown as RpcClient;
}

describe("healthcheck.delete tool", () => {
  test("declares destructive effect + the manage rule", () => {
    const tool = createHealthcheckDeleteTool();
    expect(tool.name).toBe("healthcheck.delete");
    expect(tool.effect).toBe("destructive");
    expect(tool.requiredAccessRules).toEqual(["healthcheck.healthcheck.manage"]);
    expect(typeof tool.dryRun).toBe("function");
  });

  test("dryRun resolves the target and NEVER deletes", async () => {
    const getConfiguration = mock(() => Promise.resolve(config));
    const deleteConfiguration = mock(() => Promise.resolve());
    const rpcClient = fakeRpcClient({ getConfiguration, deleteConfiguration });
    const tool = createHealthcheckDeleteTool();
    const preview = await tool.dryRun!({
      input: { id: "hc1" },
      principal,
      rpcClient,
    });
    expect(deleteConfiguration).not.toHaveBeenCalled();
    expect(preview.summary).toContain("google-com-http");
    expect(preview.summary).toContain("permanent");
    expect(preview.payload).toEqual({ id: "hc1" });
  });

  test("dryRun throws a clear error when the id is unknown", async () => {
    const rpcClient = fakeRpcClient({
      getConfiguration: mock(() => Promise.resolve(undefined)),
      deleteConfiguration: mock(),
    });
    const tool = createHealthcheckDeleteTool();
    await expect(
      tool.dryRun!({ input: { id: "nope" }, principal, rpcClient }),
    ).rejects.toThrow(/No health check found/);
  });

  test("execute (apply) deletes via deleteConfiguration", async () => {
    const deleteConfiguration = mock(() => Promise.resolve());
    const rpcClient = fakeRpcClient({
      getConfiguration: mock(() => Promise.resolve(config)),
      deleteConfiguration,
    });
    const tool = createHealthcheckDeleteTool();
    const result = await tool.execute({ input: { id: "hc1" }, principal, rpcClient });
    expect(deleteConfiguration).toHaveBeenCalledWith("hc1");
    expect(result).toEqual({ id: "hc1", deleted: true });
  });
});
