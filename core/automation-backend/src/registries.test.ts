import { describe, it, expect, beforeEach } from "bun:test";
import { z } from "zod";
import { createHook, Versioned } from "@checkstack/backend-api";
import type { RpcClient } from "@checkstack/backend-api";
import {
  createTriggerRegistry,
  type TriggerRegistry,
} from "./trigger-registry";
import {
  createActionRegistry,
  type ActionRegistry,
} from "./action-registry";
import {
  createArtifactTypeRegistry,
  type ArtifactTypeRegistry,
} from "./artifact-type-registry";
import type {
  ActionDefinition,
  ActionExecutionContext,
  ArtifactTypeDefinition,
  TriggerDefinition,
} from "./action-types";

const testPlugin = { pluginId: "test-plugin" } as const;
const otherPlugin = { pluginId: "other-plugin" } as const;

// ─── Shared fixtures ────────────────────────────────────────────────────

const incidentPayload = z.object({
  incidentId: z.string(),
  severity: z.enum(["info", "degraded", "critical"]),
});
const incidentHook = createHook<z.infer<typeof incidentPayload>>(
  "incident.created",
);

const jiraConfig = z.object({
  projectKey: z.string(),
  summary: z.string(),
});

const jiraIssueData = z.object({
  issueKey: z.string(),
  url: z.string(),
});

// ─── Trigger registry ───────────────────────────────────────────────────

describe("TriggerRegistry", () => {
  let registry: TriggerRegistry;
  beforeEach(() => {
    registry = createTriggerRegistry();
  });

  it("registers a hook-backed trigger with fully qualified id", () => {
    const def: TriggerDefinition<z.infer<typeof incidentPayload>> = {
      id: "incident.created",
      displayName: "Incident Created",
      category: "Incidents",
      payloadSchema: incidentPayload,
      hook: incidentHook,
      contextKey: (p) => p.incidentId,
    };
    registry.register(def, testPlugin);

    expect(registry.hasTrigger("test-plugin.incident.created")).toBe(true);
    const t = registry.getTrigger("test-plugin.incident.created");
    expect(t?.qualifiedId).toBe("test-plugin.incident.created");
    expect(t?.ownerPluginId).toBe("test-plugin");
    expect(t?.category).toBe("Incidents");
    expect(t?.hook).toBe(incidentHook);
  });

  it("defaults category to Uncategorized", () => {
    registry.register(
      {
        id: "x",
        displayName: "X",
        payloadSchema: incidentPayload,
        hook: incidentHook,
      },
      testPlugin,
    );
    expect(registry.getTrigger("test-plugin.x")?.category).toBe("Uncategorized");
  });

  it("generates JSON Schema from zod payload schema", () => {
    registry.register(
      {
        id: "x",
        displayName: "X",
        payloadSchema: incidentPayload,
        hook: incidentHook,
      },
      testPlugin,
    );
    const jsonSchema = registry.getTrigger("test-plugin.x")?.payloadJsonSchema;
    expect(jsonSchema).toBeDefined();
    expect(jsonSchema?.type).toBe("object");
  });

  it("preserves the contextKey extractor", () => {
    registry.register(
      {
        id: "x",
        displayName: "X",
        payloadSchema: incidentPayload,
        hook: incidentHook,
        contextKey: (p) => p.incidentId,
      },
      testPlugin,
    );
    const t = registry.getTrigger("test-plugin.x");
    expect(
      t?.contextKey?.({ incidentId: "inc-42", severity: "critical" }),
    ).toBe("inc-42");
  });

  it("rejects a trigger without hook or setup (unreachable)", () => {
    expect(() =>
      registry.register(
        {
          id: "broken",
          displayName: "Broken",
          payloadSchema: incidentPayload,
        },
        testPlugin,
      ),
    ).toThrow(/neither a hook nor a setup callback/);
  });

  it("rejects duplicate registrations", () => {
    const def: TriggerDefinition<z.infer<typeof incidentPayload>> = {
      id: "dup",
      displayName: "D",
      payloadSchema: incidentPayload,
      hook: incidentHook,
    };
    registry.register(def, testPlugin);
    expect(() => registry.register(def, testPlugin)).toThrow(/already registered/);
  });

  it("namespaces by plugin id (no collision across plugins)", () => {
    const def: TriggerDefinition<z.infer<typeof incidentPayload>> = {
      id: "x",
      displayName: "X",
      payloadSchema: incidentPayload,
      hook: incidentHook,
    };
    registry.register(def, testPlugin);
    registry.register(def, otherPlugin);
    expect(registry.getTriggers().map((t) => t.qualifiedId).sort()).toEqual([
      "other-plugin.x",
      "test-plugin.x",
    ]);
  });

  it("groups triggers by category", () => {
    registry.register(
      {
        id: "a",
        displayName: "A",
        category: "Incidents",
        payloadSchema: incidentPayload,
        hook: incidentHook,
      },
      testPlugin,
    );
    registry.register(
      {
        id: "b",
        displayName: "B",
        category: "Time",
        payloadSchema: incidentPayload,
        hook: incidentHook,
      },
      testPlugin,
    );
    const byCat = registry.getTriggersByCategory();
    expect(byCat.size).toBe(2);
    expect(byCat.get("Incidents")?.length).toBe(1);
    expect(byCat.get("Time")?.length).toBe(1);
  });

  it("supports setup-backed (non-hook) triggers", () => {
    let cleanupCalled = false;
    registry.register(
      {
        id: "time.cron",
        displayName: "Cron",
        payloadSchema: z.object({ scheduledAt: z.string() }),
        config: new Versioned({
          version: 1,
          schema: z.object({ pattern: z.string() }),
        }),
        setup: async () => async () => {
          cleanupCalled = true;
        },
      },
      testPlugin,
    );

    const t = registry.getTrigger("test-plugin.time.cron");
    expect(t?.setup).toBeDefined();
    expect(t?.configJsonSchema).toBeDefined();
    expect(cleanupCalled).toBe(false);
  });
});

// ─── Action registry ────────────────────────────────────────────────────

describe("ActionRegistry", () => {
  let registry: ActionRegistry;
  beforeEach(() => {
    registry = createActionRegistry();
  });

  const jiraCreate: ActionDefinition<z.infer<typeof jiraConfig>, { issueKey: string; url: string }> = {
    id: "jira.create_issue",
    displayName: "Create Jira issue",
    category: "Jira",
    config: new Versioned({ version: 1, schema: jiraConfig }),
    // Local artifact id — the registry qualifies it with the plugin id.
    produces: "issue",
    execute: async () => ({ success: true }),
  };

  it("registers an action with namespaced id and qualifies its produces", () => {
    registry.register(jiraCreate, testPlugin);
    expect(registry.hasAction("test-plugin.jira.create_issue")).toBe(true);
    const a = registry.getAction("test-plugin.jira.create_issue");
    expect(a?.qualifiedId).toBe("test-plugin.jira.create_issue");
    expect(a?.ownerPluginId).toBe("test-plugin");
    // `produces` is qualified with the owning plugin, matching how the
    // artifact-type registry qualifies the artifact type's own id.
    expect(a?.produces).toBe("test-plugin.issue");
  });

  it("generates JSON Schema from zod config", () => {
    registry.register(jiraCreate, testPlugin);
    const a = registry.getAction("test-plugin.jira.create_issue");
    expect(a?.configJsonSchema).toBeDefined();
    expect(a?.configJsonSchema?.type).toBe("object");
  });

  it("rejects duplicate registrations", () => {
    registry.register(jiraCreate, testPlugin);
    expect(() => registry.register(jiraCreate, testPlugin)).toThrow(
      /already registered/,
    );
  });

  it("groups actions by category", () => {
    registry.register(jiraCreate, testPlugin);
    registry.register(
      {
        id: "incident.create",
        displayName: "Create Incident",
        category: "Incident",
        config: new Versioned({ version: 1, schema: z.object({}) }),
        execute: async () => ({ success: true }),
      },
      testPlugin,
    );

    const byCat = registry.getActionsByCategory();
    expect(byCat.size).toBe(2);
    expect(byCat.get("Jira")?.length).toBe(1);
    expect(byCat.get("Incident")?.length).toBe(1);
  });

  it("calls execute with the typed context shape", async () => {
    let captured: ActionExecutionContext<z.infer<typeof jiraConfig>> | undefined;
    registry.register(
      {
        id: "captured",
        displayName: "Captured",
        config: new Versioned({ version: 1, schema: jiraConfig }),
        execute: async (ctx) => {
          captured = ctx;
          return { success: true };
        },
      },
      testPlugin,
    );

    const a = registry.getAction("test-plugin.captured");
    const result = await a?.execute({
      config: { projectKey: "PROJ", summary: "Test" },
      consumedArtifacts: {},
      runId: "r-1",
      automationId: "a-1",
      contextKey: null,
      logger: {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
      } as unknown as ActionExecutionContext<unknown>["logger"],
      getService: async () => {
        throw new Error("no service in test");
      },
      rpcClient: { forPlugin: () => ({}) } as unknown as RpcClient,
    });

    expect(result?.success).toBe(true);
    expect(captured?.config.projectKey).toBe("PROJ");
  });
});

// ─── Artifact-type registry ─────────────────────────────────────────────

describe("ArtifactTypeRegistry", () => {
  let registry: ArtifactTypeRegistry;
  beforeEach(() => {
    registry = createArtifactTypeRegistry();
  });

  const jiraIssue: ArtifactTypeDefinition<z.infer<typeof jiraIssueData>> = {
    id: "issue",
    displayName: "Jira Issue",
    schema: jiraIssueData,
  };

  it("registers an artifact type with namespaced id", () => {
    registry.register(jiraIssue, { pluginId: "jira" });
    expect(registry.hasArtifactType("jira.issue")).toBe(true);
    const t = registry.getArtifactType("jira.issue");
    expect(t?.qualifiedId).toBe("jira.issue");
    expect(t?.ownerPluginId).toBe("jira");
  });

  it("generates JSON Schema from zod schema", () => {
    registry.register(jiraIssue, { pluginId: "jira" });
    const t = registry.getArtifactType("jira.issue");
    expect(t?.jsonSchema).toBeDefined();
    expect(t?.jsonSchema?.type).toBe("object");
  });

  it("rejects duplicates", () => {
    registry.register(jiraIssue, { pluginId: "jira" });
    expect(() =>
      registry.register(jiraIssue, { pluginId: "jira" }),
    ).toThrow(/already registered/);
  });

  it("returns all registered types", () => {
    registry.register(jiraIssue, { pluginId: "jira" });
    registry.register(
      {
        id: "message",
        displayName: "Teams Message",
        schema: z.object({ messageId: z.string() }),
      },
      { pluginId: "teams" },
    );
    expect(registry.getArtifactTypes().map((t) => t.qualifiedId).sort()).toEqual([
      "jira.issue",
      "teams.message",
    ]);
  });
});
