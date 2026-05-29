/**
 * Deep validation of an automation definition.
 *
 * `AutomationDefinitionSchema` only validates the structural shape —
 * action `config` is typed as `z.record(z.unknown())`, so it never
 * checks a provider action's config against that action's own schema.
 * This walker fills the gap so the editor can surface *any* wrong
 * content, not just structural errors:
 *
 *   - unknown trigger `event` / action `action` ids,
 *   - per-trigger `config` that violates the trigger's `configSchema`,
 *   - per-action `config` that violates the action's config schema
 *     (wrong enum value, missing required field, wrong type, AND —
 *     because we validate in strict mode — unknown/typo'd keys).
 *
 * Returned issue `path`s are dot-joinable for display, e.g.
 * `actions.0.config.level` or `triggers.1.event`.
 */
import { z } from "zod";
import {
  AutomationDefinitionSchema,
  type ActionInput,
  type AutomationDefinition,
} from "@checkstack/automation-common";
import type { ActionRegistry } from "./action-registry";
import type { TriggerRegistry } from "./trigger-registry";

export interface DefinitionIssue {
  path: Array<string | number>;
  message: string;
}

export interface ValidateDefinitionDeps {
  triggerRegistry: TriggerRegistry;
  actionRegistry: ActionRegistry;
}

/**
 * Validate a definition both structurally and semantically. Returns an
 * empty array when the definition is fully valid.
 *
 * Structural errors short-circuit the semantic pass: if the top-level
 * shape is wrong we can't reliably walk the action tree, so we return
 * the structural issues alone and let the operator fix those first.
 */
export function collectDefinitionIssues(
  definition: unknown,
  deps: ValidateDefinitionDeps,
): DefinitionIssue[] {
  const parsed = AutomationDefinitionSchema.safeParse(definition);
  if (!parsed.success) {
    return parsed.error.issues.map((issue) => ({
      path: issue.path.map((segment) => toPathSegment(segment)),
      message: issue.message,
    }));
  }

  const issues: DefinitionIssue[] = [];
  validateTriggers(parsed.data, deps, issues);
  validateActionList(parsed.data.actions, ["actions"], deps, issues);
  return issues;
}

function validateTriggers(
  definition: AutomationDefinition,
  deps: ValidateDefinitionDeps,
  issues: DefinitionIssue[],
): void {
  for (const [index, trigger] of definition.triggers.entries()) {
    const registered = deps.triggerRegistry.getTrigger(trigger.event);
    if (!registered) {
      issues.push({
        path: ["triggers", index, "event"],
        message: `Unknown trigger event "${trigger.event}"`,
      });
      continue;
    }
    if (registered.configSchema) {
      const result = strictParse(registered.configSchema, trigger.config ?? {});
      if (!result.success) {
        pushZodIssues(result.error, ["triggers", index, "config"], issues);
      }
    }
  }
}

function validateActionList(
  actions: ActionInput[],
  basePath: Array<string | number>,
  deps: ValidateDefinitionDeps,
  issues: DefinitionIssue[],
): void {
  for (const [index, action] of actions.entries()) {
    validateAction(action, [...basePath, index], deps, issues);
  }
}

function validateAction(
  action: ActionInput,
  path: Array<string | number>,
  deps: ValidateDefinitionDeps,
  issues: DefinitionIssue[],
): void {
  if ("action" in action) {
    const registered = deps.actionRegistry.getAction(action.action);
    if (!registered) {
      issues.push({
        path: [...path, "action"],
        message: `Unknown action "${action.action}"`,
      });
      return;
    }
    const result = strictParse(registered.config.schema, action.config);
    if (!result.success) {
      pushZodIssues(result.error, [...path, "config"], issues);
    }
    return;
  }

  if ("choose" in action) {
    for (const [branchIndex, branch] of action.choose.entries()) {
      validateActionList(
        branch.sequence,
        [...path, "choose", branchIndex, "sequence"],
        deps,
        issues,
      );
    }
    if (action.else) {
      validateActionList(action.else, [...path, "else"], deps, issues);
    }
    return;
  }

  if ("parallel" in action) {
    validateActionList(action.parallel, [...path, "parallel"], deps, issues);
    return;
  }

  if ("repeat" in action) {
    validateActionList(
      action.repeat.sequence,
      [...path, "repeat", "sequence"],
      deps,
      issues,
    );
    return;
  }

  if ("sequence" in action) {
    validateActionList(action.sequence, [...path, "sequence"], deps, issues);
    return;
  }

  // delay / variables / condition / stop / wait_for_trigger carry no
  // provider config to deep-validate — their structure is already fully
  // covered by AutomationDefinitionSchema.
}

/**
 * Parse against a schema in strict mode when it's a plain object schema,
 * so unknown / typo'd config keys are reported rather than silently
 * stripped. Non-object schemas (unions, records, primitives) fall back
 * to a normal parse.
 */
function strictParse(schema: z.ZodType<unknown>, value: unknown) {
  if (schema instanceof z.ZodObject) {
    return schema.strict().safeParse(value);
  }
  return schema.safeParse(value);
}

function pushZodIssues(
  error: z.ZodError,
  basePath: Array<string | number>,
  issues: DefinitionIssue[],
): void {
  for (const issue of error.issues) {
    issues.push({
      path: [...basePath, ...issue.path.map((segment) => toPathSegment(segment))],
      message: issue.message,
    });
  }
}

/**
 * Zod issue paths are `PropertyKey[]` (string | number | symbol). The
 * automation contract's issue path is `(string | number)[]`, so coerce
 * the rare symbol segment to its string form.
 */
function toPathSegment(segment: PropertyKey): string | number {
  return typeof segment === "number" || typeof segment === "string"
    ? segment
    : String(segment);
}
