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
    Promise.resolve([{ id: "app-ok", name: "OK", accessRules: ["*"] }]),
  ),
  listActions = mock(() => Promise.resolve({ items: [] })),
  listConnectionSummaries = mock(() => Promise.resolve([])),
  resolveConnectionOptions = mock(() => Promise.resolve([])),
}: {
  getBindableApplications?: ReturnType<typeof mock>;
  listActions?: ReturnType<typeof mock>;
  listConnectionSummaries?: ReturnType<typeof mock>;
  resolveConnectionOptions?: ReturnType<typeof mock>;
} = {}): RpcClient {
  return {
    forPlugin: () => ({
      getBindableApplications,
      listActions,
      listConnectionSummaries,
      resolveConnectionOptions,
    }),
  } as unknown as RpcClient;
}

/** A create_issue action whose schema carries dynamic-option fields. */
const jiraActionWithOptions = {
  qualifiedId: "integration-jira.create_issue",
  displayName: "Create Issue",
  category: "Jira",
  ownerPluginId: "integration-jira",
  consumes: [],
  connectionProviderId: "integration-jira.jira",
  configSchema: {
    type: "object",
    properties: {
      connectionId: { type: "string", "x-options-resolver": "connectionOptions" },
      projectKey: { type: "string", "x-options-resolver": "projectOptions" },
      issueTypeId: {
        type: "string",
        "x-options-resolver": "issueTypeOptions",
        "x-depends-on": ["connectionId", "projectKey"],
      },
    },
  },
};

/** Connection lookup + a resolver that knows OPS/ENG projects and OPS issue types. */
function optionsClient(
  overrides: Partial<Parameters<typeof fakeRpcClient>[0]> = {},
): RpcClient {
  return fakeRpcClient({
    listActions: mock(() =>
      Promise.resolve({ items: [jiraActionWithOptions] }),
    ),
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
    resolveConnectionOptions: mock(
      ({ resolverName, context }: { resolverName: string; context: Record<string, unknown> }) => {
        if (resolverName === "projectOptions") {
          return Promise.resolve([{ value: "OPS", label: "Ops" }, { value: "ENG", label: "Eng" }]);
        }
        if (resolverName === "issueTypeOptions") {
          return Promise.resolve(
            context.projectKey === "OPS" ? [{ value: "10001", label: "Bug" }] : [],
          );
        }
        return Promise.resolve([]);
      },
    ),
    ...overrides,
  });
}

/** A create_issue action with the given config, as the sole definition action. */
function createIssueInput(config: Record<string, unknown>): AutomationProposeInput {
  return makeInput({
    definition: {
      ...makeInput().definition,
      actions: [
        {
          id: "open_issue",
          action: "integration-jira.create_issue",
          config,
          enabled: true,
          continue_on_error: false,
        },
      ],
    },
  });
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

describe("collectProposeIssues — dynamic option fields", () => {
  test("flags an invalid dropdown value (not offered by the connection)", async () => {
    const issues = await collectProposeIssues({
      input: createIssueInput({ connectionId: "conn-real", projectKey: "BAD" }),
      rpcClient: optionsClient(),
    });
    const issue = issues.find(
      (i) => i.path.join(".") === "actions.0.config.projectKey",
    );
    expect(issue?.message).toMatch(/not a valid projectKey/);
    expect(issue?.message).toMatch(/resolveActionOptions/);
  });

  test("accepts valid values, resolving a cascade (issueTypeId needs projectKey)", async () => {
    const issues = await collectProposeIssues({
      input: createIssueInput({
        connectionId: "conn-real",
        projectKey: "OPS",
        issueTypeId: "10001",
      }),
      rpcClient: optionsClient(),
    });
    expect(issues).toEqual([]);
  });

  test("flags a cascade child invalid for its parent's value", async () => {
    const issues = await collectProposeIssues({
      input: createIssueInput({
        connectionId: "conn-real",
        projectKey: "OPS",
        issueTypeId: "99999", // not an OPS issue type
      }),
      rpcClient: optionsClient(),
    });
    expect(
      issues.some((i) => i.path.join(".") === "actions.0.config.issueTypeId"),
    ).toBe(true);
  });

  test("skips a templated dropdown value (resolved only at run time)", async () => {
    const issues = await collectProposeIssues({
      input: createIssueInput({
        connectionId: "conn-real",
        projectKey: "{{ trigger.payload.project }}",
      }),
      rpcClient: optionsClient(),
    });
    expect(issues).toEqual([]);
  });

  test("skips (does not block) when the option resolver itself fails", async () => {
    const issues = await collectProposeIssues({
      input: createIssueInput({ connectionId: "conn-real", projectKey: "BAD" }),
      rpcClient: optionsClient({
        resolveConnectionOptions: mock(() => Promise.reject(new Error("jira down"))),
      }),
    });
    expect(issues).toEqual([]);
  });
});

describe("collectProposeIssues — runAs action permissions", () => {
  /** create_issue tagged with the access rule its runAs must hold. */
  const jiraActionWithRule = {
    ...jiraAction,
    requiredAccessRules: ["integration-jira.create_issue.manage"],
  };

  function ruleClient({
    runAsRules,
  }: {
    runAsRules: string[];
  }): RpcClient {
    return fakeRpcClient({
      getBindableApplications: mock(() =>
        Promise.resolve([{ id: "app-ok", name: "Test", accessRules: runAsRules }]),
      ),
      listActions: mock(() => Promise.resolve({ items: [jiraActionWithRule] })),
    });
  }

  test("flags an action whose rule the runAs service account lacks", async () => {
    const issues = await collectProposeIssues({
      input: createIssueInput({ connectionId: "conn-x" }),
      rpcClient: ruleClient({ runAsRules: [] }),
    });
    const issue = issues.find((i) => i.path.join(".") === "actions.0.action");
    expect(issue?.message).toMatch(/not permitted to run/);
    expect(issue?.message).toMatch(/integration-jira\.create_issue\.manage/);
  });

  test("passes when the runAs holds the required rule", async () => {
    const issues = await collectProposeIssues({
      input: createIssueInput({ connectionId: "conn-x" }),
      rpcClient: ruleClient({
        runAsRules: ["integration-jira.create_issue.manage"],
      }),
    });
    expect(
      issues.some((i) => /not permitted to run/.test(i.message)),
    ).toBe(false);
  });

  test("a wildcard (admin) runAs satisfies any action rule", async () => {
    const issues = await collectProposeIssues({
      input: createIssueInput({ connectionId: "conn-x" }),
      rpcClient: ruleClient({ runAsRules: ["*"] }),
    });
    expect(
      issues.some((i) => /not permitted to run/.test(i.message)),
    ).toBe(false);
  });
});
