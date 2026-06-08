/**
 * Tests for the caller-scoped propose-time checks: `runAs` bindability and
 * `connectionId` existence. A fake user-scoped RPC client stands in for the
 * auth / automation / integration plugins.
 */
import { describe, expect, mock, test } from "bun:test";
import type { RpcClient } from "@checkstack/backend-api";
import type { AutomationProposeInput } from "./automation-propose";
import { collectProposeIssues } from "./automation-propose-validate";

function makeInput(
  overrides: Partial<AutomationProposeInput> = {},
): AutomationProposeInput {
  return {
    name: "My automation",
    runAs: "app-ok",
    definition: {
      name: "My automation",
      triggers: [{ event: "incident.incident.created" }],
      conditions: [],
      actions: [],
      mode: "single",
      concurrency_scope: "automation",
      max_runs: 1,
    },
    ...overrides,
  };
}

function fakeRpcClient({
  getBindableApplications = mock(() =>
    Promise.resolve([{ id: "app-ok", name: "OK" }]),
  ),
  listActions = mock(() => Promise.resolve({ items: [] })),
  listConnectionSummaries = mock(() => Promise.resolve([])),
}: {
  getBindableApplications?: ReturnType<typeof mock>;
  listActions?: ReturnType<typeof mock>;
  listConnectionSummaries?: ReturnType<typeof mock>;
} = {}): RpcClient {
  return {
    forPlugin: () => ({
      getBindableApplications,
      listActions,
      listConnectionSummaries,
    }),
  } as unknown as RpcClient;
}

const jiraAction = {
  qualifiedId: "integration-jira.create_issue",
  displayName: "Create Issue",
  category: "Jira",
  ownerPluginId: "integration-jira",
  configSchema: {},
  consumes: [],
  connectionProviderId: "integration-jira.jira",
};

describe("collectProposeIssues — runAs", () => {
  test("passes when runAs is in the caller's bindable list", async () => {
    const issues = await collectProposeIssues({
      input: makeInput({ runAs: "app-ok" }),
      rpcClient: fakeRpcClient(),
    });
    expect(issues).toEqual([]);
  });

  test("flags a runAs that does not exist / is not bindable", async () => {
    const issues = await collectProposeIssues({
      input: makeInput({ runAs: "system" }),
      rpcClient: fakeRpcClient(),
    });
    const runAsIssue = issues.find((i) => i.path.join(".") === "runAs");
    expect(runAsIssue?.message).toMatch(/Service account "system" does not exist/);
    expect(runAsIssue?.message).toMatch(/automation\.listServiceAccounts/);
  });

  test("emits a soft note when the bindable lookup fails", async () => {
    const issues = await collectProposeIssues({
      input: makeInput(),
      rpcClient: fakeRpcClient({
        getBindableApplications: mock(() => Promise.reject(new Error("boom"))),
      }),
    });
    expect(
      issues.some(
        (i) => i.path.join(".") === "runAs" && /Could not verify/.test(i.message),
      ),
    ).toBe(true);
  });
});

describe("collectProposeIssues — connectionId", () => {
  test("flags an unknown connectionId on a provider action", async () => {
    const input = makeInput({
      definition: {
        ...makeInput().definition,
        actions: [
          {
            id: "open_issue",
            action: "integration-jira.create_issue",
            config: { connectionId: "made-up" },
            enabled: true,
            continue_on_error: false,
          },
        ],
      },
    });
    const issues = await collectProposeIssues({
      input,
      rpcClient: fakeRpcClient({
        listActions: mock(() => Promise.resolve({ items: [jiraAction] })),
        listConnectionSummaries: mock(() =>
          Promise.resolve([
            {
              id: "conn-real",
              providerId: "integration-jira.jira",
              name: "Prod",
              configPreview: {},
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ]),
        ),
      }),
    });
    const issue = issues.find(
      (i) => i.path.join(".") === "actions.0.config.connectionId",
    );
    expect(issue?.message).toMatch(/unknown connectionId "made-up"/);
  });

  test("accepts a known connectionId", async () => {
    const input = makeInput({
      definition: {
        ...makeInput().definition,
        actions: [
          {
            id: "open_issue",
            action: "integration-jira.create_issue",
            config: { connectionId: "conn-real" },
            enabled: true,
            continue_on_error: false,
          },
        ],
      },
    });
    const issues = await collectProposeIssues({
      input,
      rpcClient: fakeRpcClient({
        listActions: mock(() => Promise.resolve({ items: [jiraAction] })),
        listConnectionSummaries: mock(() =>
          Promise.resolve([
            {
              id: "conn-real",
              providerId: "integration-jira.jira",
              name: "Prod",
              configPreview: {},
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ]),
        ),
      }),
    });
    expect(issues).toEqual([]);
  });

  test("emits a soft note (not silent skip) when the action catalog fails to load", async () => {
    const input = makeInput({
      definition: {
        ...makeInput().definition,
        actions: [
          {
            id: "open_issue",
            action: "integration-jira.create_issue",
            config: { connectionId: "made-up" },
            enabled: true,
            continue_on_error: false,
          },
        ],
      },
    });
    const issues = await collectProposeIssues({
      input,
      rpcClient: fakeRpcClient({
        // The catalog read fails, so we cannot tell which actions are
        // connection-backed. The check must NOT silently pass (which would let
        // the fabricated "made-up" connectionId through) - it must surface a
        // soft "could not verify" issue that still blocks the proposal.
        listActions: mock(() => Promise.reject(new Error("FORBIDDEN"))),
      }),
    });
    const issue = issues.find((i) => /Could not verify connectionId/.test(i.message));
    expect(issue).toBeDefined();
    expect(issue?.message).toMatch(/automation\.listConnections/);
  });
});
