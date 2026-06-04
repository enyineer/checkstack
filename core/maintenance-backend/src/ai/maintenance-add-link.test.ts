import { describe, expect, test, mock } from "bun:test";
import type { AuthUser, RpcClient } from "@checkstack/backend-api";
import { createMaintenanceAddLinkTool } from "./maintenance-add-link";

const principal: AuthUser = {
  type: "user",
  id: "u1",
  accessRules: ["maintenance.maintenance.manage"],
};

function fakeRpcClient({
  addLink,
}: {
  addLink: ReturnType<typeof mock>;
}): RpcClient {
  return {
    forPlugin: () => ({ addLink }),
  } as unknown as RpcClient;
}

describe("maintenance.addLink tool", () => {
  test("declares mutate effect + the manage rule", () => {
    const tool = createMaintenanceAddLinkTool();
    expect(tool.name).toBe("maintenance.addLink");
    expect(tool.effect).toBe("mutate");
    expect(tool.requiredAccessRules).toEqual([
      "maintenance.maintenance.manage",
    ]);
    expect(typeof tool.dryRun).toBe("function");
  });

  test("dryRun summarizes without adding", async () => {
    const addLink = mock(() => Promise.resolve());
    const rpcClient = fakeRpcClient({ addLink });
    const tool = createMaintenanceAddLinkTool();
    const preview = await tool.dryRun!({
      input: {
        maintenanceId: "m1",
        label: "Runbook",
        url: "https://example.com/runbook",
      },
      principal,
      rpcClient,
    });
    expect(addLink).not.toHaveBeenCalled();
    expect(preview.summary).toContain("Runbook");
  });

  test("execute adds via addLink", async () => {
    const addLink = mock(() =>
      Promise.resolve({
        id: "l1",
        maintenanceId: "m1",
        label: "Runbook",
        url: "https://example.com/runbook",
        createdAt: new Date(),
      }),
    );
    const rpcClient = fakeRpcClient({ addLink });
    const tool = createMaintenanceAddLinkTool();
    const result = await tool.execute({
      input: {
        maintenanceId: "m1",
        label: "Runbook",
        url: "https://example.com/runbook",
      },
      principal,
      rpcClient,
    });
    expect(addLink).toHaveBeenCalledWith({
      maintenanceId: "m1",
      label: "Runbook",
      url: "https://example.com/runbook",
    });
    expect(result.link.id).toBe("l1");
  });
});
