import { describe, expect, it } from "bun:test";
import type { PluginMetadata } from "@checkstack/common";
import type { AutomationTemplateInput } from "@checkstack/automation-common";
import { createAutomationTemplateRegistry } from "./template-registry";

const plugin: PluginMetadata = { pluginId: "demo" } as PluginMetadata;

function template(over: Partial<AutomationTemplateInput> = {}): AutomationTemplateInput {
  return {
    id: "example",
    name: "Example",
    description: "An example template",
    category: "Testing",
    definition: {
      name: "Example",
      triggers: [{ event: "healthcheck.system_degraded" }],
      conditions: [],
      actions: [{ id: "log_it", action: "automation.log", config: { message: "hi" } }],
    },
    ...over,
  };
}

describe("createAutomationTemplateRegistry", () => {
  it("qualifies the id and stamps ownerPluginId from the plugin metadata", () => {
    const registry = createAutomationTemplateRegistry();
    registry.register(template(), plugin);
    const [stored] = registry.list();
    expect(stored.id).toBe("demo.example");
    expect(stored.ownerPluginId).toBe("demo");
  });

  it("normalizes the input by applying schema defaults (enabled/continue_on_error/mode)", () => {
    const registry = createAutomationTemplateRegistry();
    registry.register(template(), plugin);
    const [stored] = registry.list();
    // Defaults applied on parse.
    expect(stored.definition.mode).toBe("single");
    expect(stored.definition.actions[0]).toMatchObject({
      enabled: true,
      continue_on_error: false,
    });
  });

  it("throws on a duplicate qualified id", () => {
    const registry = createAutomationTemplateRegistry();
    registry.register(template(), plugin);
    expect(() => registry.register(template(), plugin)).toThrow(/already registered/);
  });

  it("listValidated returns only what setValidated was given", () => {
    const registry = createAutomationTemplateRegistry();
    registry.register(template(), plugin);
    expect(registry.listValidated()).toEqual([]);
    registry.setValidated(registry.list());
    expect(registry.listValidated()).toHaveLength(1);
  });
});
