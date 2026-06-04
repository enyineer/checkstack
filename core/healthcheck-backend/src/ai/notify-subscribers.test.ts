import { describe, expect, it, mock } from "bun:test";
import type { AuthUser, RpcClient } from "@checkstack/backend-api";
import {
  healthcheckSystemSubscription,
  healthcheckGroupSubscription,
} from "@checkstack/healthcheck-common";
import {
  createNotifySystemSubscribersTool,
  createNotifySystemGroupSubscribersTool,
} from "./notify-subscribers";

const principal: AuthUser = {
  type: "application",
  id: "svc",
  name: "Svc",
  accessRules: ["notification.notification.send.manage"],
  teamIds: [],
};

function makeRpcClient() {
  const notifyMock = mock(async (_input: unknown) => ({ notifiedCount: 3 }));
  const rpcClient = {
    forPlugin: () => ({ notifyForSubscription: notifyMock }),
  } as unknown as RpcClient;
  return { rpcClient, notifyMock };
}

describe("notify-subscriber tools", () => {
  it("system tool: metadata + dispatches under the system spec", async () => {
    const tool = createNotifySystemSubscribersTool();
    expect(tool.name).toBe("healthcheck.notifySystemSubscribers");
    expect(tool.effect).toBe("mutate");
    expect(tool.requiredAccessRules).toEqual([
      "notification.notification.send.manage",
    ]);
    expect(typeof tool.dryRun).toBe("function");

    const { rpcClient, notifyMock } = makeRpcClient();
    const result = await tool.execute({
      input: {
        systemId: "sys-1",
        systemName: "API Gateway",
        title: "Degraded",
        body: "API Gateway is unhealthy",
        importance: "warning",
        actionLabel: "View",
        actionUrl: "https://x/sys-1",
      },
      principal,
      rpcClient,
    });

    expect(result).toEqual({ notifiedCount: 3 });
    const call = notifyMock.mock.calls[0]![0] as {
      specId: string;
      resourceKeys: string[];
      subjects: Array<{ kind: string; id: string; name: string }>;
      action?: { label: string; url: string };
    };
    expect(call.specId).toBe(healthcheckSystemSubscription.specId);
    expect(call.resourceKeys).toEqual(["sys-1"]);
    expect(call.subjects[0]).toMatchObject({
      kind: "catalog.system",
      id: "sys-1",
      name: "API Gateway",
    });
    expect(call.action).toEqual({ label: "View", url: "https://x/sys-1" });
  });

  it("system tool: dryRun summarizes without sending", async () => {
    const tool = createNotifySystemSubscribersTool();
    const { rpcClient, notifyMock } = makeRpcClient();
    const preview = await tool.dryRun!({
      input: {
        systemId: "sys-1",
        title: "Hi",
        body: "Body",
      } as never,
      principal,
      rpcClient,
    });
    expect(preview.summary).toContain("sys-1");
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("group tool: dispatches under the group spec with a group subject", async () => {
    const tool = createNotifySystemGroupSubscribersTool();
    expect(tool.name).toBe("healthcheck.notifySystemGroupSubscribers");
    const { rpcClient, notifyMock } = makeRpcClient();
    await tool.execute({
      input: {
        groupId: "grp-1",
        groupName: "Prod",
        title: "Degraded",
        body: "A system in Prod is unhealthy",
      },
      principal,
      rpcClient,
    });
    const call = notifyMock.mock.calls[0]![0] as {
      specId: string;
      resourceKeys: string[];
      subjects: Array<{ kind: string; id: string }>;
    };
    expect(call.specId).toBe(healthcheckGroupSubscription.specId);
    expect(call.resourceKeys).toEqual(["grp-1"]);
    expect(call.subjects[0]).toMatchObject({ kind: "catalog.group", id: "grp-1" });
  });
});
