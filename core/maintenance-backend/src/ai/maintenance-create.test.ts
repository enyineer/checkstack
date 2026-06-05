import { describe, expect, test, mock } from "bun:test";
import type { AuthUser, RpcClient } from "@checkstack/backend-api";
import { createMaintenanceCreateTool } from "./maintenance-create";

const principal: AuthUser = {
  type: "user",
  id: "u1",
  accessRules: ["maintenance.maintenance.manage"],
};

function fakeRpcClient({
  createMaintenance,
}: {
  createMaintenance: ReturnType<typeof mock>;
}): RpcClient {
  return {
    forPlugin: () => ({ createMaintenance }),
  } as unknown as RpcClient;
}

const isoStart = "2026-07-01T10:00:00.000Z";
const isoEnd = "2026-07-01T12:00:00.000Z";

describe("maintenance.create tool", () => {
  test("declares mutate effect + the manage rule", () => {
    const tool = createMaintenanceCreateTool();
    expect(tool.name).toBe("maintenance.create");
    expect(tool.effect).toBe("mutate");
    expect(tool.requiredAccessRules).toEqual([
      "maintenance.maintenance.manage",
    ]);
    expect(typeof tool.dryRun).toBe("function");
  });

  test("dryRun summarizes the window without creating it", async () => {
    const createMaintenance = mock(() => Promise.resolve());
    const rpcClient = fakeRpcClient({ createMaintenance });
    const tool = createMaintenanceCreateTool();
    const preview = await tool.dryRun!({
      input: {
        title: "DB upgrade",
        startAt: new Date(isoStart),
        endAt: new Date(isoEnd),
        systemIds: ["s1"],
      },
      principal,
      rpcClient,
    });
    expect(createMaintenance).not.toHaveBeenCalled();
    expect(preview.summary).toContain("DB upgrade");
  });

  test("coerces ISO string dates to Date instances before the RPC", async () => {
    let received: { startAt: unknown; endAt: unknown } | undefined;
    const createMaintenance = mock(
      (arg: { startAt: unknown; endAt: unknown }) => {
        received = arg;
        return Promise.resolve({ id: "m1", systemIds: ["s1"] });
      },
    );
    const rpcClient = fakeRpcClient({ createMaintenance });
    const tool = createMaintenanceCreateTool();
    // The model sends ISO strings; the tool-local schema coerces them.
    const parsed = tool.input.parse({
      title: "DB upgrade",
      startAt: isoStart,
      endAt: isoEnd,
      systemIds: ["s1"],
    });
    await tool.execute({ input: parsed, principal, rpcClient });
    expect(received?.startAt instanceof Date).toBe(true);
    expect(received?.endAt instanceof Date).toBe(true);
  });

  test("rejects when endAt is not after startAt", () => {
    const tool = createMaintenanceCreateTool();
    const result = tool.input.safeParse({
      title: "Bad window",
      startAt: isoEnd,
      endAt: isoStart,
      systemIds: ["s1"],
    });
    expect(result.success).toBe(false);
  });
});
