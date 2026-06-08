import type {
  ActionInput,
  AutomationTemplate,
} from "@checkstack/automation-common";
import type { ActionRegistry } from "./action-registry";
import type { TriggerRegistry } from "./trigger-registry";
import { collectDefinitionIssues, type DefinitionIssue } from "./validate-definition";

/**
 * Collect every provider-action id referenced anywhere in an action tree
 * (descending into choose / parallel / repeat / sequence branches). Control-
 * flow actions carry no registry id, so only `"action" in action` nodes count.
 */
function collectActionIds(actions: ActionInput[], out: string[]): void {
  for (const action of actions) {
    if ("action" in action) {
      out.push(action.action);
    } else if ("choose" in action) {
      for (const branch of action.choose) collectActionIds(branch.sequence, out);
      if (action.else) collectActionIds(action.else, out);
    } else if ("parallel" in action) {
      collectActionIds(action.parallel, out);
    } else if ("repeat" in action) {
      collectActionIds(action.repeat.sequence, out);
    } else if ("sequence" in action) {
      collectActionIds(action.sequence, out);
    }
  }
}

export interface TemplateValidationResult {
  /** Templates whose every capability is installed and definition validates. */
  valid: AutomationTemplate[];
  /**
   * Templates referencing a trigger/action that is NOT registered (the owning
   * plugin is not installed). Not an error — quietly excluded.
   */
  unavailable: Array<{ template: AutomationTemplate; missing: string[] }>;
  /**
   * Templates whose capabilities are ALL installed but whose definition fails
   * validation: genuine DRIFT (a renamed/removed action config field, a
   * changed artifact-type id, a bad reference). These are logged loudly.
   */
  invalid: Array<{ template: AutomationTemplate; issues: DefinitionIssue[] }>;
}

/**
 * Validate every registered template against the LIVE trigger/action
 * registries. Splits failures into "unavailable" (a referenced capability is
 * not installed → skip silently) and "invalid" (all capabilities present but
 * the definition no longer validates → drift, surface loudly).
 *
 * The connection-id check is intentionally skipped: a template's connection
 * fields are operator-fill placeholders, not real connection ids.
 */
export async function validateTemplates({
  templates,
  triggerRegistry,
  actionRegistry,
}: {
  templates: AutomationTemplate[];
  triggerRegistry: TriggerRegistry;
  actionRegistry: ActionRegistry;
}): Promise<TemplateValidationResult> {
  const result: TemplateValidationResult = {
    valid: [],
    unavailable: [],
    invalid: [],
  };

  for (const template of templates) {
    const { definition } = template;
    const actionIds: string[] = [];
    collectActionIds(definition.actions, actionIds);

    const missing = [
      ...definition.triggers
        .map((t) => t.event)
        .filter((event) => !triggerRegistry.hasTrigger(event)),
      ...actionIds.filter((id) => !actionRegistry.hasAction(id)),
    ];
    if (missing.length > 0) {
      result.unavailable.push({ template, missing: [...new Set(missing)] });
      continue;
    }

    const issues = await collectDefinitionIssues(definition, {
      triggerRegistry,
      actionRegistry,
    });
    if (issues.length > 0) {
      result.invalid.push({ template, issues });
      continue;
    }

    result.valid.push(template);
  }

  return result;
}
