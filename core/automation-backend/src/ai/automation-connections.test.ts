import { describe, expect, test, mock } from "bun:test";
import type { AuthUser, RpcClient } from "@checkstack/backend-api";
import { AutomationApi } from "@checkstack/automation-common";
import { createAutomationListConnectionsTool } from "./automation-connections";

/** The connections tool ignores the principal; a minimal real user suffices. */
const testPrincipal: AuthUser = {
  type: "user",
  id: "u1",
  accessRules: ["automation.automation.read"],
};

/** A catalog action exposing the connection provider it pulls config from. */
interface FakeAction {
  qualifiedId: string;
  connectionProviderId?: string;
}

interface FakeConnection {
  id: string;
  name: string;
}

/**
 * A fake user-scoped client wiring two surfaces:
 *
 *   - `AutomationApi.listActions` - the connection-capable providers the tool
 *     discovers from (gated by `automation.read`, like the tool itself), NOT
 *     the integration plugin's admin-gated `listProviders`.
 *   - `IntegrationApi.listConnectionSummaries` - per-provider configured connections.
 *
 * `listConnectionSummaries` records the provider ids it was called with so a test can
 * assert filtering and that config-only providers are never queried.
 *
 * Optional `failListActions` / `failConnectionsFor` simulate FORBIDDEN/transient
 * read failures to exercise graceful degradation. The fake distinguishes the
 * two surfaces by the requested API object's identity, so an admin-only RPC can
 * never be silently substituted for the read-gated one.
 */
function fakeRpcClient({
  actions,
  connectionsByProvider,
  failListActions = false,
  failConnectionsFor = new Set<string>(),
}: {
  actions: FakeAction[];
  connectionsByProvider: Record<string, FakeConnection[]>;
  failListActions?: boolean;
  failConnectionsFor?: Set<string>;
}): { rpcClient: RpcClient; calledProviderIds: string[] } {
  const calledProviderIds: string[] = [];

  const automationSurface = {
    listActions: mock(() => {
      if (failListActions) return Promise.reject(new Error("FORBIDDEN"));
      return Promise.resolve({
        items: actions.map((a) => ({
          qualifiedId: a.qualifiedId,
          displayName: a.qualifiedId,
          category: "Uncategorized",
          ownerPluginId: a.qualifiedId.split(".")[0],
          configSchema: {},
          consumes: [],
          connectionProviderId: a.connectionProviderId,
        })),
      });
    }),
  };

  const integrationSurface = {
    listConnectionSummaries: mock(({ providerId }: { providerId: string }) => {
      calledProviderIds.push(providerId);
      if (failConnectionsFor.has(providerId)) {
        return Promise.reject(new Error("FORBIDDEN"));
      }
      const conns = connectionsByProvider[providerId] ?? [];
      return Promise.resolve(
        conns.map((c) => ({
          id: c.id,
          providerId,
          name: c.name,
          configPreview: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        })),
      );
    }),
  };

  const rpcClient = {
    forPlugin: (api: unknown) =>
      api === AutomationApi ? automationSurface : integrationSurface,
  } as unknown as RpcClient;
  return { rpcClient, calledProviderIds };
}

describe("automation.listConnections tool", () => {
  test("declares read effect gated by the automation read rule", () => {
    const tool = createAutomationListConnectionsTool();
    expect(tool.name).toBe("automation.listConnections");
    expect(tool.effect).toBe("read");
    expect(tool.requiredAccessRules).toEqual(["automation.automation.read"]);
    expect(tool.dryRun).toBeUndefined();
  });

  test("groups connections by provider, skipping connection-less actions", async () => {
    const tool = createAutomationListConnectionsTool();
    const { rpcClient, calledProviderIds } = fakeRpcClient({
      actions: [
        {
          qualifiedId: "integration-jira.create_issue",
          connectionProviderId: "integration-jira.jira",
        },
        {
          qualifiedId: "integration-teams.send_message",
          connectionProviderId: "integration-teams.teams",
        },
        // A non-integration action declares no connection provider and must
        // contribute nothing to the discovered set.
        { qualifiedId: "automation.run_script" },
      ],
      connectionsByProvider: {
        "integration-jira.jira": [
          { id: "conn-jira-1", name: "Prod Jira" },
          { id: "conn-jira-2", name: "Staging Jira" },
        ],
        "integration-teams.teams": [{ id: "conn-teams-1", name: "Ops Teams" }],
      },
    });

    const out = await tool.execute({ input: {}, principal: testPrincipal, rpcClient });

    // Actions with no connection provider contribute no provider to query.
    expect(calledProviderIds).not.toContain("automation.run_script");
    const ids = out.providers.map((p) => p.providerId).sort();
    expect(ids).toEqual(["integration-jira.jira", "integration-teams.teams"]);

    const jira = out.providers.find(
      (p) => p.providerId === "integration-jira.jira",
    );
    expect(jira?.connections).toEqual([
      { id: "conn-jira-1", name: "Prod Jira" },
      { id: "conn-jira-2", name: "Staging Jira" },
    ]);
    expect(out.note).toMatch(/connectionId/i);
  });

  test("filters to a single provider when providerId is given", async () => {
    const tool = createAutomationListConnectionsTool();
    const { rpcClient, calledProviderIds } = fakeRpcClient({
      actions: [
        {
          qualifiedId: "integration-jira.create_issue",
          connectionProviderId: "integration-jira.jira",
        },
        {
          qualifiedId: "integration-teams.send_message",
          connectionProviderId: "integration-teams.teams",
        },
      ],
      connectionsByProvider: {
        "integration-jira.jira": [{ id: "conn-jira-1", name: "Prod Jira" }],
        "integration-teams.teams": [{ id: "conn-teams-1", name: "Ops Teams" }],
      },
    });

    const out = await tool.execute({
      input: { providerId: "integration-jira.jira" },
      principal: testPrincipal,
      rpcClient,
    });

    expect(calledProviderIds).toEqual(["integration-jira.jira"]);
    expect(out.providers).toEqual([
      {
        providerId: "integration-jira.jira",
        connections: [{ id: "conn-jira-1", name: "Prod Jira" }],
      },
    ]);
  });

  test("returns a do-not-hand-roll note when no connections are configured", async () => {
    const tool = createAutomationListConnectionsTool();
    const { rpcClient } = fakeRpcClient({
      actions: [
        {
          qualifiedId: "integration-jira.create_issue",
          connectionProviderId: "integration-jira.jira",
        },
      ],
      connectionsByProvider: {},
    });
    const out = await tool.execute({ input: {}, principal: testPrincipal, rpcClient });
    expect(out.providers).toEqual([
      { providerId: "integration-jira.jira", connections: [] },
    ]);
    expect(out.note).toMatch(/never hand-roll a URL or token/i);
  });

  test("degrades to an empty result when the action catalog read fails", async () => {
    const tool = createAutomationListConnectionsTool();
    const { rpcClient, calledProviderIds } = fakeRpcClient({
      actions: [
        {
          qualifiedId: "integration-jira.create_issue",
          connectionProviderId: "integration-jira.jira",
        },
      ],
      connectionsByProvider: {
        "integration-jira.jira": [{ id: "conn-jira-1", name: "Prod Jira" }],
      },
      failListActions: true,
    });

    const out = await tool.execute({ input: {}, principal: testPrincipal, rpcClient });

    // No providers discoverable, no connection RPC attempted, no hard error.
    expect(out.providers).toEqual([]);
    expect(calledProviderIds).toEqual([]);
    expect(out.note).toMatch(/never hand-roll a URL or token/i);
  });

  test("degrades to empty connections when a provider's listing fails", async () => {
    const tool = createAutomationListConnectionsTool();
    const { rpcClient } = fakeRpcClient({
      actions: [
        {
          qualifiedId: "integration-jira.create_issue",
          connectionProviderId: "integration-jira.jira",
        },
        {
          qualifiedId: "integration-teams.send_message",
          connectionProviderId: "integration-teams.teams",
        },
      ],
      connectionsByProvider: {
        "integration-teams.teams": [{ id: "conn-teams-1", name: "Ops Teams" }],
      },
      failConnectionsFor: new Set(["integration-jira.jira"]),
    });

    const out = await tool.execute({ input: {}, principal: testPrincipal, rpcClient });

    const jira = out.providers.find(
      (p) => p.providerId === "integration-jira.jira",
    );
    const teams = out.providers.find(
      (p) => p.providerId === "integration-teams.teams",
    );
    // The forbidden provider yields an empty list; the readable one still works.
    expect(jira?.connections).toEqual([]);
    expect(teams?.connections).toEqual([{ id: "conn-teams-1", name: "Ops Teams" }]);
  });
});
