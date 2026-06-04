import { describe, expect, test, mock } from "bun:test";
import type { AuthUser, RpcClient } from "@checkstack/backend-api";
import { createMaintenanceUpdateTool } from "./maintenance-update";

const principal: AuthUser = {
  type: "user",
  id: "u1",
  accessRules: ["maintenance.maintenance.manage"],
};

const existing = {
  id: "m1",
  title: "DB upgrade",
  description: "Planned upgrade",
  suppressNotifications: false,
  status: "scheduled" as const,
  startAt: new Date("2026-07-01T10:00:00.000Z"),
  endAt: new Date("2026-07-01T12:00:00.000Z"),
  createdAt: new Date(),
  updatedAt: new Date(),
  systemIds: ["s1"],
  updates: [],
  links: [],
};

function fakeRpcClient({
  getMaintenance,
  updateMaintenance,
}: {
  getMaintenance: ReturnType<typeof mock>;
  updateMaintenance: ReturnType<typeof mock>;
}): RpcClient {
  return {
    forPlugin: () => ({ getMaintenance, updateMaintenance }),
  } as unknown as RpcClient;
}

describe("maintenance.update tool", () => {
  test("declares mutate effect + the manage rule", () => {
    const tool = createMaintenanceUpdateTool();
    expect(tool.name).toBe("maintenance.update");
    expect(tool.effect).toBe("mutate");
    expect(tool.requiredAccessRules).toEqual([
      "maintenance.maintenance.manage",
    ]);
    expect(typeof tool.dryRun).toBe("function");
  });

  test("dryRun fetches the maintenance and returns a diff", async () => {
    const getMaintenance = mock(() => Promise.resolve(existing));
    const updateMaintenance = mock(() => Promise.resolve());
    const rpcClient = fakeRpcClient({ getMaintenance, updateMaintenance });
    const tool = createMaintenanceUpdateTool();
    const preview = await tool.dryRun!({
      input: { id: "m1", title: "DB upgrade v2" },
      principal,
      rpcClient,
    });
    expect(getMaintenance).toHaveBeenCalledWith({ id: "m1" });
    expect(updateMaintenance).not.toHaveBeenCalled();
    expect(preview.diff).toBeDefined();
    expect(preview.summary).toContain("DB upgrade");
  });

  test("dryRun throws a clear error when the id is unknown", async () => {
    const rpcClient = fakeRpcClient({
      getMaintenance: mock(() => Promise.resolve(null)),
      updateMaintenance: mock(),
    });
    const tool = createMaintenanceUpdateTool();
    await expect(
      tool.dryRun!({ input: { id: "nope" }, principal, rpcClient }),
    ).rejects.toThrow(/No maintenance found/);
  });

  test("coerces ISO string dates to Date instances before the RPC", async () => {
    let received: { startAt: unknown; endAt: unknown } | undefined;
    const getMaintenance = mock(() => Promise.resolve(existing));
    const updateMaintenance = mock(
      (arg: { startAt: unknown; endAt: unknown }) => {
        received = arg;
        return Promise.resolve({ ...existing });
      },
    );
    const rpcClient = fakeRpcClient({ getMaintenance, updateMaintenance });
    const tool = createMaintenanceUpdateTool();
    const parsed = tool.input.parse({
      id: "m1",
      startAt: "2026-07-02T10:00:00.000Z",
      endAt: "2026-07-02T12:00:00.000Z",
    });
    await tool.execute({ input: parsed, principal, rpcClient });
    expect(received?.startAt instanceof Date).toBe(true);
    expect(received?.endAt instanceof Date).toBe(true);
  });
});
