import { describe, expect, test, mock } from "bun:test";
import type { RpcClient } from "@checkstack/backend-api";
import { AutomationApi } from "@checkstack/automation-common";
import { createAutomationResolveOptionsTool } from "./automation-action-options";

const tool = createAutomationResolveOptionsTool();

const CREATE_ISSUE_ACTION = {
  qualifiedId: "integration-jira.create_issue",
  displayName: "Create Jira Issue",
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
      summary: { type: "string" },
    },
  },
};

/**
 * Fake user-scoped client: AutomationApi.listActions returns the catalog;
 * IntegrationApi.resolveConnectionOptions records its args so a test can assert
 * the provider/connection/resolver/context threaded through, and returns canned
 * options (or throws when `failResolver`).
 */
function fakeRpcClient({
  actions = [CREATE_ISSUE_ACTION],
  optionsByResolver = {} as Record<
    string,
    Array<{ value: string; label: string }>
  >,
  failResolver = false,
  failListActions = false,
}: {
  actions?: unknown[];
  optionsByResolver?: Record<string, Array<{ value: string; label: string }>>;
  failResolver?: boolean;
  failListActions?: boolean;
} = {}): { rpcClient: RpcClient; resolveCalls: unknown[] } {
  const resolveCalls: unknown[] = [];
  const automationSurface = {
    listActions: mock(() =>
      failListActions
        ? Promise.reject(new Error("FORBIDDEN"))
        : Promise.resolve({ items: actions }),
    ),
  };
  const integrationSurface = {
    resolveConnectionOptions: mock((args: { resolverName: string }) => {
      resolveCalls.push(args);
      if (failResolver) return Promise.reject(new Error("jira down"));
      return Promise.resolve(optionsByResolver[args.resolverName] ?? []);
    }),
  };
  const rpcClient = {
    forPlugin: (api: unknown) =>
      api === AutomationApi ? automationSurface : integrationSurface,
  } as unknown as RpcClient;
  return { rpcClient, resolveCalls };
}

describe("automation.resolveActionOptions tool", () => {
  test("is a read tool gated by the automation read rule", () => {
    expect(tool.name).toBe("automation.resolveActionOptions");
    expect(tool.effect).toBe("read");
    expect(tool.requiredAccessRules).toEqual(["automation.automation.read"]);
    expect(tool.dryRun).toBeUndefined();
  });

  test("resolves a top-level dropdown field's options", async () => {
    const { rpcClient, resolveCalls } = fakeRpcClient({
      optionsByResolver: {
        projectOptions: [
          { value: "OPS", label: "Ops (OPS)" },
          { value: "ENG", label: "Engineering (ENG)" },
        ],
      },
    });
    const out = await tool.execute({
      input: {
        action: "integration-jira.create_issue",
        field: "projectKey",
        connectionId: "conn-1",
      },
      principal: { type: "user", id: "u1", accessRules: [] },
      rpcClient,
    });
    expect(out.options.map((o) => o.value)).toEqual(["OPS", "ENG"]);
    expect(out.note).toMatch(/value/i);
    expect(resolveCalls).toEqual([
      {
        providerId: "integration-jira.jira",
        connectionId: "conn-1",
        resolverName: "projectOptions",
        context: {},
      },
    ]);
  });

  test("threads a cascade dependency into the resolver context", async () => {
    const { rpcClient, resolveCalls } = fakeRpcClient({
      optionsByResolver: { issueTypeOptions: [{ value: "10001", label: "Bug" }] },
    });
    const out = await tool.execute({
      input: {
        action: "integration-jira.create_issue",
        field: "issueTypeId",
        connectionId: "conn-1",
        dependencies: { projectKey: "OPS" },
      },
      principal: { type: "user", id: "u1", accessRules: [] },
      rpcClient,
    });
    expect(out.options.map((o) => o.value)).toEqual(["10001"]);
    expect(resolveCalls).toEqual([
      {
        providerId: "integration-jira.jira",
        connectionId: "conn-1",
        resolverName: "issueTypeOptions",
        context: { projectKey: "OPS" },
      },
    ]);
  });

  test("asks for the missing dependency instead of resolving blindly", async () => {
    const { rpcClient, resolveCalls } = fakeRpcClient();
    const out = await tool.execute({
      input: {
        action: "integration-jira.create_issue",
        field: "issueTypeId",
        connectionId: "conn-1",
      },
      principal: { type: "user", id: "u1", accessRules: [] },
      rpcClient,
    });
    expect(out.options).toEqual([]);
    expect(out.note).toMatch(/depends on projectKey/);
    expect(resolveCalls).toEqual([]); // never called the resolver
  });

  test("a free-form field reports no dynamic options + lists the dropdown fields", async () => {
    const { rpcClient } = fakeRpcClient();
    const out = await tool.execute({
      input: {
        action: "integration-jira.create_issue",
        field: "summary",
        connectionId: "conn-1",
      },
      principal: { type: "user", id: "u1", accessRules: [] },
      rpcClient,
    });
    expect(out.options).toEqual([]);
    expect(out.note).toMatch(/no dynamic options/i);
    expect(out.note).toMatch(/projectKey/);
  });

  test("an unknown action returns a recoverable note", async () => {
    const { rpcClient } = fakeRpcClient();
    const out = await tool.execute({
      input: { action: "nope.nope", field: "x", connectionId: "c" },
      principal: { type: "user", id: "u1", accessRules: [] },
      rpcClient,
    });
    expect(out.options).toEqual([]);
    expect(out.note).toMatch(/Unknown action/);
  });

  test("a resolver failure degrades to a soft note, not a throw", async () => {
    const { rpcClient } = fakeRpcClient({ failResolver: true });
    const out = await tool.execute({
      input: {
        action: "integration-jira.create_issue",
        field: "projectKey",
        connectionId: "conn-1",
      },
      principal: { type: "user", id: "u1", accessRules: [] },
      rpcClient,
    });
    expect(out.options).toEqual([]);
    expect(out.note).toMatch(/could not resolve/i);
  });
});
