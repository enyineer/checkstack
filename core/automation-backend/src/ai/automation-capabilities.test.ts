import { describe, expect, test, mock } from "bun:test";
import type { AuthUser, RpcClient } from "@checkstack/backend-api";
import {
  ListCapabilitiesOutputSchema,
  GetCapabilitySchemaOutputSchema,
} from "@checkstack/ai-common";
import {
  createAutomationListCapabilitiesTool,
  createAutomationGetCapabilitySchemaTool,
} from "./automation-capabilities";

const principal: AuthUser = {
  type: "user",
  id: "u1",
  accessRules: ["automation.automation.read"],
};

/** A real-shaped trigger config schema; the round-trip must preserve it. */
const TRIGGER = {
  qualifiedId: "incident.created",
  displayName: "Incident created",
  description: "Fires when an incident opens",
  category: "Incidents",
  ownerPluginId: "incident",
  payloadSchema: {
    type: "object",
    properties: { incidentId: { type: "string" } },
  },
  configSchema: {
    type: "object",
    properties: { severity: { type: "string", enum: ["low", "high"] } },
    required: ["severity"],
  },
};

const ACTION_CONFIG_SCHEMA = {
  type: "object",
  properties: {
    channel: { type: "string", description: "Slack channel" },
    message: { type: "string" },
  },
  required: ["channel", "message"],
  additionalProperties: false,
};

const ACTION = {
  qualifiedId: "slack.postMessage",
  displayName: "Post Slack message",
  description: "Send a message to a Slack channel",
  category: "Notifications",
  ownerPluginId: "slack",
  configSchema: ACTION_CONFIG_SCHEMA,
  consumes: [],
};

const ARTIFACT_TYPE = {
  qualifiedId: "incident.summary",
  displayName: "Incident summary",
  description: "A structured incident summary artifact",
  ownerPluginId: "incident",
  schema: {
    type: "object",
    properties: { title: { type: "string" } },
    required: ["title"],
  },
};

function fakeAutomationRpcClient(): RpcClient {
  return {
    forPlugin: () => ({
      listTriggers: mock(() => Promise.resolve({ items: [TRIGGER] })),
      listActions: mock(() => Promise.resolve({ items: [ACTION] })),
      listArtifactTypes: mock(() =>
        Promise.resolve({ items: [ARTIFACT_TYPE] }),
      ),
    }),
  } as unknown as RpcClient;
}

describe("automation.listCapabilities tool", () => {
  test("declares read effect gated by the automation read rule", () => {
    const tool = createAutomationListCapabilitiesTool();
    expect(tool.name).toBe("automation.listCapabilities");
    expect(tool.effect).toBe("read");
    expect(tool.requiredAccessRules).toEqual(["automation.automation.read"]);
    // read tools never define a dryRun
    expect(tool.dryRun).toBeUndefined();
  });

  test("maps triggers, actions, and artifact-types to roles with compact summaries", async () => {
    const tool = createAutomationListCapabilitiesTool();
    const out = await tool.execute({
      input: {},
      principal,
      rpcClient: fakeAutomationRpcClient(),
    });
    expect(ListCapabilitiesOutputSchema.safeParse(out).success).toBe(true);
    expect(out.context).toBe("automation");
    expect(out.truncated).toBe(false);

    const trigger = out.entries.find((e) => e.id === "incident.created");
    const action = out.entries.find((e) => e.id === "slack.postMessage");
    const artifactType = out.entries.find((e) => e.id === "incident.summary");
    expect(trigger?.role).toBe("trigger");
    expect(action?.role).toBe("action");
    expect(artifactType?.role).toBe("artifact-type");

    // Compact summary only - never the full schema.
    expect(trigger?.configSummary).toEqual([
      { name: "severity", type: "enum", required: true },
    ]);
    expect(action?.configSummary).toEqual([
      { name: "channel", type: "string", required: true },
      { name: "message", type: "string", required: true },
    ]);
    expect(
      (trigger as unknown as Record<string, unknown>).configSchema,
    ).toBeUndefined();
  });
});

describe("automation.getCapabilitySchema tool", () => {
  test("declares read effect gated by the automation read rule", () => {
    const tool = createAutomationGetCapabilitySchemaTool();
    expect(tool.name).toBe("automation.getCapabilitySchema");
    expect(tool.effect).toBe("read");
    expect(tool.requiredAccessRules).toEqual(["automation.automation.read"]);
    expect(tool.dryRun).toBeUndefined();
  });

  test("returns ONE kind's FULL config schema intact (round-trip)", async () => {
    const tool = createAutomationGetCapabilitySchemaTool();
    const out = await tool.execute({
      input: { kind: "slack.postMessage" },
      principal,
      rpcClient: fakeAutomationRpcClient(),
    });
    expect(GetCapabilitySchemaOutputSchema.safeParse(out).success).toBe(true);
    expect(out.context).toBe("automation");
    expect(out.id).toBe("slack.postMessage");
    expect(out.role).toBe("action");
    // The crux: the FULL schema is returned unchanged.
    expect(out.configSchema).toEqual(ACTION_CONFIG_SCHEMA);
  });

  test("returns a trigger's full config schema", async () => {
    const tool = createAutomationGetCapabilitySchemaTool();
    const out = await tool.execute({
      input: { kind: "incident.created" },
      principal,
      rpcClient: fakeAutomationRpcClient(),
    });
    expect(out.role).toBe("trigger");
    expect(out.configSchema).toEqual(TRIGGER.configSchema);
  });

  test("automation kinds never expose resultSchema/assertionOperators (collector-only)", async () => {
    const tool = createAutomationGetCapabilitySchemaTool();
    const out = await tool.execute({
      input: { kind: "incident.created" },
      principal,
      rpcClient: fakeAutomationRpcClient(),
    });
    expect(out.resultSchema).toBeUndefined();
    expect(out.assertionOperators).toBeUndefined();
  });

  test("throws a clear error for an unknown kind", async () => {
    const tool = createAutomationGetCapabilitySchemaTool();
    await expect(
      tool.execute({
        input: { kind: "does-not-exist" },
        principal,
        rpcClient: fakeAutomationRpcClient(),
      }),
    ).rejects.toThrow(/unknown.*does-not-exist/i);
  });
});
