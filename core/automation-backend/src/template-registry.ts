import type { PluginMetadata } from "@checkstack/common";
import {
  AutomationTemplateSchema,
  type AutomationTemplate,
  type AutomationTemplateInput,
} from "@checkstack/automation-common";

/**
 * In-memory registry of curated example-automation templates contributed by
 * core + plugins through `automationTemplateExtensionPoint`.
 *
 * Two views:
 *   - `list()` returns every registered template (raw, pre-validation) — used
 *     by tests and the startup validator.
 *   - `listValidated()` returns only the templates that passed startup
 *     validation against the live registries (set once via `setValidated`
 *     in `afterPluginsReady`). The RPC handler serves this view, so an
 *     operator never sees a template that references an uninstalled or
 *     drifted capability.
 *
 * Like the action/trigger registries this is derived, deterministic code
 * rebuilt identically on every pod — no shared-state concern.
 */
export interface AutomationTemplateRegistry {
  register(template: AutomationTemplateInput, pluginMetadata: PluginMetadata): void;
  list(): AutomationTemplate[];
  setValidated(templates: AutomationTemplate[]): void;
  listValidated(): AutomationTemplate[];
}

export function createAutomationTemplateRegistry(): AutomationTemplateRegistry {
  const templates = new Map<string, AutomationTemplate>();
  let validated: AutomationTemplate[] = [];

  return {
    register(template, pluginMetadata) {
      const qualifiedId = `${pluginMetadata.pluginId}.${template.id}`;
      if (templates.has(qualifiedId)) {
        throw new Error(
          `Automation template ${qualifiedId} already registered — likely a duplicate registration in ${pluginMetadata.pluginId}.`,
        );
      }
      // Parse through the schema to normalize the input (apply `enabled` /
      // `continue_on_error` / `conditions` / `mode` defaults) into a fully
      // shaped AutomationTemplate, and to reject a structurally bad template
      // at registration time rather than at serve time.
      const normalized = AutomationTemplateSchema.parse({
        ...template,
        id: qualifiedId,
        ownerPluginId: pluginMetadata.pluginId,
      });
      templates.set(qualifiedId, normalized);
    },

    list() {
      return [...templates.values()];
    },

    setValidated(next) {
      validated = next;
    },

    listValidated() {
      return validated;
    },
  };
}
