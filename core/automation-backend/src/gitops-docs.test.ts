import { describe, it, expect, beforeEach } from "bun:test";
import { z } from "zod";
import { createHook, Versioned } from "@checkstack/backend-api";
import { CHECKSTACK_API_VERSION } from "@checkstack/gitops-common";
import type { SpecSchemaDocumentationProvider } from "@checkstack/gitops-common";
import { createTriggerRegistry } from "./trigger-registry";
import { createActionRegistry } from "./action-registry";
import {
  buildAutomationSpecSchemaDocumentation,
  registerAutomationGitOpsDocumentation,
} from "./gitops-docs";

const testPlugin = { pluginId: "test-plugin" } as const;

/**
 * Stub kind registry capturing the registered doc PROVIDER. The eager
 * registration methods throw if hit, proving the docs path only registers a
 * lazy provider.
 */
function createCapturingKindRegistry() {
  const providers: SpecSchemaDocumentationProvider[] = [];
  return {
    providers,
    registry: {
      registerKind: () => {
        throw new Error("registerKind should not be called by docs");
      },
      registerKindExtension: () => {
        throw new Error("registerKindExtension should not be called by docs");
      },
      registerSpecSchemaDocumentation: () => {
        throw new Error(
          "registerSpecSchemaDocumentation (eager) should not be called by docs",
        );
      },
      registerSpecSchemaDocumentationProvider: (
        provider: SpecSchemaDocumentationProvider,
      ) => {
        providers.push(provider);
      },
    },
  };
}

describe("buildAutomationSpecSchemaDocumentation", () => {
  let triggerRegistry: ReturnType<typeof createTriggerRegistry>;
  let actionRegistry: ReturnType<typeof createActionRegistry>;

  beforeEach(() => {
    triggerRegistry = createTriggerRegistry();
    actionRegistry = createActionRegistry();
  });

  it("emits triggers[].config docs only for triggers with a configSchema", () => {
    // Setup-backed trigger WITH config schema.
    triggerRegistry.register(
      {
        id: "time.cron",
        displayName: "Cron",
        description: "Runs on a cron schedule.",
        payloadSchema: z.object({ scheduledAt: z.string() }),
        configSchema: z.object({ pattern: z.string() }),
        setup: async () => async () => {},
      },
      testPlugin,
    );
    // Hook-backed trigger WITHOUT config schema — should be skipped.
    triggerRegistry.register(
      {
        id: "incident.created",
        displayName: "Incident Created",
        payloadSchema: z.object({ incidentId: z.string() }),
        hook: createHook<{ incidentId: string }>("incident.created"),
      },
      testPlugin,
    );

    const docs = buildAutomationSpecSchemaDocumentation({
      triggerRegistry,
      actionRegistry,
    });

    const triggerDocs = docs.filter((c) => c.fieldPath === "triggers[].config");
    expect(triggerDocs.length).toBe(1);

    const cron = triggerDocs[0];
    expect(cron?.kind).toBe("Automation");
    expect(cron?.apiVersion).toBe(CHECKSTACK_API_VERSION);
    expect(cron?.variantId).toBe("test-plugin.time.cron");
    expect(cron?.label).toBe("Cron");
    expect(cron?.description).toContain("ID: test-plugin.time.cron");
    expect(cron?.description).toContain("Runs on a cron schedule.");
    expect(cron?.schema).toBe(
      triggerRegistry.getTrigger("test-plugin.time.cron")!.configSchema!,
    );
    // No conditions: the trigger config is a standalone variant the kind
    // browser surfaces directly (mirrors Healthcheck's primary `config`).
    expect(cron?.conditions).toBeUndefined();
  });

  it("emits actions[].config docs for each registered provider action", () => {
    const jiraConfig = z.object({ projectKey: z.string() });
    actionRegistry.register(
      {
        id: "jira.create_issue",
        displayName: "Create Jira issue",
        description: "Creates a Jira issue.",
        config: new Versioned({ version: 1, schema: jiraConfig }),
        execute: async () => ({ success: true }),
      },
      testPlugin,
    );

    const docs = buildAutomationSpecSchemaDocumentation({
      triggerRegistry,
      actionRegistry,
    });

    const actionDocs = docs.filter((c) => c.fieldPath === "actions[].config");
    expect(actionDocs.length).toBe(1);

    const jira = actionDocs[0];
    expect(jira?.kind).toBe("Automation");
    expect(jira?.apiVersion).toBe(CHECKSTACK_API_VERSION);
    expect(jira?.variantId).toBe("test-plugin.jira.create_issue");
    expect(jira?.label).toBe("Create Jira issue");
    expect(jira?.description).toContain("ID: test-plugin.jira.create_issue");
    expect(jira?.description).toContain("Creates a Jira issue.");
    expect(jira?.schema).toBe(jiraConfig);
    // No conditions: each provider action is a standalone variant in the
    // kind browser's single `actions[].config` dropdown.
    expect(jira?.conditions).toBeUndefined();
  });

  it("falls back to just the ID when a registration has no description", () => {
    actionRegistry.register(
      {
        id: "noop",
        displayName: "No-op",
        config: new Versioned({ version: 1, schema: z.object({}) }),
        execute: async () => ({ success: true }),
      },
      testPlugin,
    );

    const docs = buildAutomationSpecSchemaDocumentation({
      triggerRegistry,
      actionRegistry,
    });

    const doc = docs.find((c) => c.variantId === "test-plugin.noop");
    expect(doc?.description).toBe("ID: test-plugin.noop");
  });

  it("emits nothing when both registries are empty", () => {
    const docs = buildAutomationSpecSchemaDocumentation({
      triggerRegistry,
      actionRegistry,
    });
    expect(docs.length).toBe(0);
  });
});

describe("registerAutomationGitOpsDocumentation", () => {
  let triggerRegistry: ReturnType<typeof createTriggerRegistry>;
  let actionRegistry: ReturnType<typeof createActionRegistry>;

  beforeEach(() => {
    triggerRegistry = createTriggerRegistry();
    actionRegistry = createActionRegistry();
  });

  it("registers a LAZY provider (not eager entries)", () => {
    const { providers, registry } = createCapturingKindRegistry();
    registerAutomationGitOpsDocumentation({
      kindRegistry: registry,
      triggerRegistry,
      actionRegistry,
    });
    expect(providers.length).toBe(1);
  });

  it("provider reflects actions registered AFTER it was registered (order-independent)", () => {
    const { providers, registry } = createCapturingKindRegistry();

    // Register the provider while the registries are still empty — this is
    // the real-world race: automation registers docs before other plugins
    // contribute their provider actions.
    registerAutomationGitOpsDocumentation({
      kindRegistry: registry,
      triggerRegistry,
      actionRegistry,
    });

    // Provider invoked now (empty) returns nothing.
    expect(providers[0]!().length).toBe(0);

    // A later plugin registers its action.
    actionRegistry.register(
      {
        id: "late.action",
        displayName: "Late Action",
        config: new Versioned({ version: 1, schema: z.object({}) }),
        execute: async () => ({ success: true }),
      },
      testPlugin,
    );

    // Re-invoking the SAME provider now surfaces the late action.
    const later = providers[0]!();
    expect(later.length).toBe(1);
    expect(later[0]?.variantId).toBe("test-plugin.late.action");
    expect(later[0]?.fieldPath).toBe("actions[].config");
  });
});
