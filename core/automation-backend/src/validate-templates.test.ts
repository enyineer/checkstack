import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { Versioned } from "@checkstack/backend-api";
import type { AutomationTemplate } from "@checkstack/automation-common";
import { createActionRegistry } from "./action-registry";
import { createTriggerRegistry } from "./trigger-registry";
import { createArtifactTypeRegistry } from "./artifact-type-registry";
import type {
  ActionDefinition,
  TriggerDefinition,
} from "./action-types";
import { createHook } from "@checkstack/backend-api";
import { validateTemplates } from "./validate-templates";

// ─── Fixtures: a registry seeded with `core.log` + `core.system_degraded` ──

const logAction: ActionDefinition<{ message: string }, void> = {
  id: "log",
  displayName: "Log",
  category: "Test",
  config: new Versioned({ version: 1, schema: z.object({ message: z.string() }) }),
  execute: async () => ({ success: true }),
};

const degradedHook = createHook<{ systemId: string }>("core.system_degraded");
const degradedTrigger: TriggerDefinition<{ systemId: string }> = {
  id: "system_degraded",
  displayName: "System Degraded",
  category: "Test",
  payloadSchema: z.object({ systemId: z.string() }),
  hook: degradedHook,
  contextKey: (p) => p.systemId,
};

function seededRegistries() {
  const actionRegistry = createActionRegistry();
  actionRegistry.register(
    logAction as ActionDefinition<unknown, unknown>,
    { pluginId: "core" } as never,
  );
  const triggerRegistry = createTriggerRegistry();
  triggerRegistry.register(
    degradedTrigger as TriggerDefinition<unknown, unknown>,
    { pluginId: "core" } as never,
  );
  return { actionRegistry, triggerRegistry, artifactTypeRegistry: createArtifactTypeRegistry() };
}

function tmpl(over: Partial<AutomationTemplate> = {}): AutomationTemplate {
  return {
    id: "core.t",
    name: "T",
    description: "d",
    category: "Test",
    ownerPluginId: "core",
    definition: {
      name: "T",
      triggers: [{ event: "core.system_degraded" }],
      conditions: [],
      actions: [
        { id: "log_it", action: "core.log", config: { message: "hi" }, enabled: true, continue_on_error: false },
      ],
      mode: "single",
      concurrency_scope: "automation",
      max_runs: 10,
    },
    ...over,
  };
}

describe("validateTemplates", () => {
  it("marks a template VALID when every capability is installed and config is sound", async () => {
    const { actionRegistry, triggerRegistry } = seededRegistries();
    const result = await validateTemplates({
      templates: [tmpl()],
      actionRegistry,
      triggerRegistry,
    });
    expect(result.valid).toHaveLength(1);
    expect(result.unavailable).toHaveLength(0);
    expect(result.invalid).toHaveLength(0);
  });

  it("marks a template UNAVAILABLE (not invalid) when a referenced capability is not installed", async () => {
    const { actionRegistry, triggerRegistry } = seededRegistries();
    const missingActionTemplate = tmpl({
      definition: {
        name: "T",
        triggers: [{ event: "core.system_degraded" }],
        conditions: [],
        actions: [
          { id: "file", action: "integration-jira.create_issue", config: {}, enabled: true, continue_on_error: false },
        ],
        mode: "single",
        concurrency_scope: "automation",
        max_runs: 10,
      },
    });
    const result = await validateTemplates({
      templates: [missingActionTemplate],
      actionRegistry,
      triggerRegistry,
    });
    expect(result.valid).toHaveLength(0);
    expect(result.invalid).toHaveLength(0);
    expect(result.unavailable).toHaveLength(1);
    expect(result.unavailable[0].missing).toContain("integration-jira.create_issue");
  });

  it("marks a template INVALID (drift) when capabilities are installed but config no longer validates", async () => {
    const { actionRegistry, triggerRegistry } = seededRegistries();
    const driftedTemplate = tmpl({
      definition: {
        name: "T",
        triggers: [{ event: "core.system_degraded" }],
        conditions: [],
        actions: [
          // `message` is required + must be a string; an unknown key / wrong
          // type is exactly the drift a renamed config field produces.
          { id: "log_it", action: "core.log", config: { renamed_message: "hi" }, enabled: true, continue_on_error: false },
        ],
        mode: "single",
        concurrency_scope: "automation",
        max_runs: 10,
      },
    });
    const result = await validateTemplates({
      templates: [driftedTemplate],
      actionRegistry,
      triggerRegistry,
    });
    expect(result.valid).toHaveLength(0);
    expect(result.unavailable).toHaveLength(0);
    expect(result.invalid).toHaveLength(1);
  });
});
