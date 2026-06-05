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
 *   - per-trigger `config` that violates the trigger's versioned `config` schema,
 *   - per-action `config` that violates the action's config schema
 *     (wrong enum value, missing required field, wrong type, AND —
 *     because we validate in strict mode — unknown/typo'd keys).
 *
 * Returned issue `path`s are dot-joinable for display, e.g.
 * `actions.0.config.level` or `triggers.1.event`.
 */
import { z } from "zod";
import type { Versioned } from "@checkstack/backend-api";
import { extractErrorMessage } from "@checkstack/common";
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
export async function collectDefinitionIssues(
  definition: unknown,
  deps: ValidateDefinitionDeps,
): Promise<DefinitionIssue[]> {
  const parsed = AutomationDefinitionSchema.safeParse(definition);
  if (!parsed.success) {
    return parsed.error.issues.map((issue) => ({
      path: issue.path.map((segment) => toPathSegment(segment)),
      message: issue.message,
    }));
  }

  const issues: DefinitionIssue[] = [];
  await validateTriggers(parsed.data, deps, issues);
  await validateActionList(parsed.data.actions, ["actions"], deps, issues);
  validateActionIds(parsed.data.actions, ["actions"], deps, issues);
  return issues;
}

// ─── Semantic action-id validation ──────────────────────────────────────

/**
 * Walk the entire action tree and enforce the two artifact-reference
 * invariants the structural zod pass can't:
 *
 *   1. Every action `id` is unique within the automation (so
 *      `artifacts.<id>.<name>` is unambiguous).
 *   2. Any provider action whose registered action declares a truthy
 *      `produces` MUST carry an `id` (so the produced artifact is
 *      referenceable).
 *
 * Identifier-format is already enforced by the zod schema in the
 * structural pass, so we don't re-check it here.
 */
function validateActionIds(
  actions: ActionInput[],
  basePath: Array<string | number>,
  deps: ValidateDefinitionDeps,
  issues: DefinitionIssue[],
): void {
  const seen = new Set<string>();
  walkActionIds(actions, basePath, deps, seen, issues);
}

function walkActionIds(
  actions: ActionInput[],
  basePath: Array<string | number>,
  deps: ValidateDefinitionDeps,
  seen: Set<string>,
  issues: DefinitionIssue[],
): void {
  for (const [index, action] of actions.entries()) {
    walkActionId(action, [...basePath, index], deps, seen, issues);
  }
}

function walkActionId(
  action: ActionInput,
  path: Array<string | number>,
  deps: ValidateDefinitionDeps,
  seen: Set<string>,
  issues: DefinitionIssue[],
): void {
  if (typeof action.id === "string") {
    if (seen.has(action.id)) {
      issues.push({
        path: [...path, "id"],
        message: `Action id "${action.id}" must be unique within the automation`,
      });
    } else {
      seen.add(action.id);
    }
  }

  if ("action" in action) {
    const registered = deps.actionRegistry.getAction(action.action);
    if (registered?.produces && !action.id) {
      issues.push({
        path: [...path, "id"],
        message:
          "Actions that produce an artifact must have an id so the artifact can be referenced as artifacts.<id>.<name>",
      });
    }
    return;
  }

  if ("choose" in action) {
    for (const [branchIndex, branch] of action.choose.entries()) {
      walkActionIds(
        branch.sequence,
        [...path, "choose", branchIndex, "sequence"],
        deps,
        seen,
        issues,
      );
    }
    if (action.else) {
      walkActionIds(action.else, [...path, "else"], deps, seen, issues);
    }
    return;
  }

  if ("parallel" in action) {
    walkActionIds(action.parallel, [...path, "parallel"], deps, seen, issues);
    return;
  }

  if ("repeat" in action) {
    walkActionIds(
      action.repeat.sequence,
      [...path, "repeat", "sequence"],
      deps,
      seen,
      issues,
    );
    return;
  }

  if ("sequence" in action) {
    walkActionIds(action.sequence, [...path, "sequence"], deps, seen, issues);
    return;
  }

  // delay / variables / condition / stop / wait_for_trigger have no child
  // action lists and don't produce artifacts — nothing more to walk.
}

async function validateTriggers(
  definition: AutomationDefinition,
  deps: ValidateDefinitionDeps,
  issues: DefinitionIssue[],
): Promise<void> {
  for (const [index, trigger] of definition.triggers.entries()) {
    const registered = deps.triggerRegistry.getTrigger(trigger.event);
    if (!registered) {
      issues.push({
        path: ["triggers", index, "event"],
        message: `Unknown trigger event "${trigger.event}"`,
      });
      continue;
    }
    if (registered.config) {
      // Migrate-then-STRICT: removed/renamed trigger config fields are
      // migrated away before validation, but real typos still surface.
      await collectVersionedIssues({
        config: registered.config,
        value: trigger.config ?? {},
        basePath: ["triggers", index, "config"],
        issues,
      });
    }
  }
}

async function validateActionList(
  actions: ActionInput[],
  basePath: Array<string | number>,
  deps: ValidateDefinitionDeps,
  issues: DefinitionIssue[],
): Promise<void> {
  for (const [index, action] of actions.entries()) {
    await validateAction(action, [...basePath, index], deps, issues);
  }
}

async function validateAction(
  action: ActionInput,
  path: Array<string | number>,
  deps: ValidateDefinitionDeps,
  issues: DefinitionIssue[],
): Promise<void> {
  if ("action" in action) {
    const registered = deps.actionRegistry.getAction(action.action);
    if (!registered) {
      issues.push({
        path: [...path, "action"],
        message: `Unknown action "${action.action}"`,
      });
      return;
    }
    // Migrate-then-STRICT (assume-v1-on-read): a stored config that
    // carries a now-removed key (e.g. `sandbox`) is migrated away before
    // validation, so it no longer surfaces as "Unrecognized key" in the
    // editor — while genuine typos the migration doesn't account for still
    // do.
    await collectVersionedIssues({
      config: registered.config,
      value: action.config,
      basePath: [...path, "config"],
      issues,
    });
    return;
  }

  if ("choose" in action) {
    for (const [branchIndex, branch] of action.choose.entries()) {
      await validateActionList(
        branch.sequence,
        [...path, "choose", branchIndex, "sequence"],
        deps,
        issues,
      );
    }
    if (action.else) {
      await validateActionList(action.else, [...path, "else"], deps, issues);
    }
    return;
  }

  if ("parallel" in action) {
    await validateActionList(
      action.parallel,
      [...path, "parallel"],
      deps,
      issues,
    );
    return;
  }

  if ("repeat" in action) {
    await validateActionList(
      action.repeat.sequence,
      [...path, "repeat", "sequence"],
      deps,
      issues,
    );
    return;
  }

  if ("sequence" in action) {
    await validateActionList(
      action.sequence,
      [...path, "sequence"],
      deps,
      issues,
    );
    return;
  }

  // delay / variables / condition / stop / wait_for_trigger carry no
  // provider config to deep-validate — their structure is already fully
  // covered by AutomationDefinitionSchema.
}

/**
 * Migrate (assuming the stored value was written at v1) then STRICT-parse
 * a `Versioned` config, pushing any resulting Zod issues. Migration errors
 * (a broken chain or a throwing `migrate`) are reported as a config issue
 * rather than thrown, so one bad action can't abort the whole validation.
 */
async function collectVersionedIssues({
  config,
  value,
  basePath,
  issues,
}: {
  config: Versioned<unknown>;
  value: unknown;
  basePath: Array<string | number>;
  issues: DefinitionIssue[];
}): Promise<void> {
  try {
    await config.parseStrictAssumingV1(value);
  } catch (error) {
    if (error instanceof z.ZodError) {
      pushZodIssues(error, basePath, issues);
      return;
    }
    issues.push({
      path: basePath,
      message: extractErrorMessage(error),
    });
  }
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
