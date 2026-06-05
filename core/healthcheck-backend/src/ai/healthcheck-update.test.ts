import { describe, expect, test, mock } from "bun:test";
import type { AuthUser, RpcClient } from "@checkstack/backend-api";
import { createHealthcheckUpdateTool } from "./healthcheck-update";

const principal: AuthUser = {
  type: "user",
  id: "u1",
  accessRules: ["healthcheck.healthcheck.manage"],
};

const httpStrategy = {
  id: "healthcheck-http.http",
  displayName: "HTTP",
  description: "HTTP probe",
  category: "network",
  configSchema: { type: "object", properties: { url: { type: "string" } } },
};

const existing = {
  id: "hc1",
  name: "google-com-http",
  strategyId: "healthcheck-http.http",
  config: { url: "https://google.com" },
  intervalSeconds: 60,
  collectors: [],
  paused: false,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function fakeRpcClient(overrides: Record<string, ReturnType<typeof mock>>): {
  rpcClient: RpcClient;
  fns: Record<string, ReturnType<typeof mock>>;
} {
  const fns = {
    getConfiguration: mock(() => Promise.resolve(existing)),
    validateConfiguration: mock(() =>
      Promise.resolve({ valid: true, errors: [] }),
    ),
    getStrategies: mock(() => Promise.resolve([httpStrategy])),
    getCollectors: mock(() => Promise.resolve([])),
    updateConfiguration: mock(() =>
      Promise.resolve({ ...existing, intervalSeconds: 30 }),
    ),
    ...overrides,
  };
  return {
    rpcClient: { forPlugin: () => fns } as unknown as RpcClient,
    fns,
  };
}

describe("healthcheck.update tool", () => {
  test("declares mutate effect + the manage rule", () => {
    const tool = createHealthcheckUpdateTool();
    expect(tool.name).toBe("healthcheck.update");
    expect(tool.effect).toBe("mutate");
    expect(tool.requiredAccessRules).toEqual(["healthcheck.healthcheck.manage"]);
  });

  test("dryRun merges the partial body and deep-validates, NEVER updating", async () => {
    const { rpcClient, fns } = fakeRpcClient({});
    const tool = createHealthcheckUpdateTool();
    const preview = await tool.dryRun!({
      input: { id: "hc1", body: { intervalSeconds: 30 } },
      principal,
      rpcClient,
    });
    expect(fns.validateConfiguration).toHaveBeenCalledTimes(1);
    expect(fns.updateConfiguration).not.toHaveBeenCalled();
    expect(preview.summary).toContain("google-com-http");
    expect(preview.summary).toContain("30s");
    expect(preview.payload).toEqual({ id: "hc1", body: { intervalSeconds: 30 } });
    // The before -> after diff captures exactly what changes.
    expect(preview.diff).toEqual([
      { path: "intervalSeconds", before: 60, after: 30 },
    ]);
  });

  test("dryRun throws when the id is unknown", async () => {
    const { rpcClient } = fakeRpcClient({
      getConfiguration: mock(() => Promise.resolve(undefined)),
    });
    const tool = createHealthcheckUpdateTool();
    await expect(
      tool.dryRun!({ input: { id: "nope", body: {} }, principal, rpcClient }),
    ).rejects.toThrow(/No health check found/);
  });

  test("dryRun surfaces a deep validation error from the merged config", async () => {
    const { rpcClient } = fakeRpcClient({
      validateConfiguration: mock(() =>
        Promise.resolve({
          valid: false,
          errors: [{ path: ["config", "url"], message: "Expected string" }],
        }),
      ),
    });
    const tool = createHealthcheckUpdateTool();
    await expect(
      tool.dryRun!({
        input: { id: "hc1", body: { config: { url: 1 } } },
        principal,
        rpcClient,
      }),
    ).rejects.toThrow(/invalid/i);
  });

  test("execute (apply) updates via updateConfiguration", async () => {
    const { rpcClient, fns } = fakeRpcClient({});
    const tool = createHealthcheckUpdateTool();
    const result = await tool.execute({
      input: { id: "hc1", body: { intervalSeconds: 30 } },
      principal,
      rpcClient,
    });
    expect(fns.updateConfiguration).toHaveBeenCalledWith({
      id: "hc1",
      body: { intervalSeconds: 30 },
    });
    expect(result.configuration.id).toBe("hc1");
  });
});
