import type {
  ActionInput,
  ChooseInput,
  ConditionGuardInput,
  DelayInput,
  ParallelInput,
  ProviderAction,
  RepeatInput,
  SequenceInput,
  StopInput,
  VariablesInput,
  WaitForTriggerInput,
  WaitUntilInput,
} from "@checkstack/automation-common";
import type { LucideIconName } from "@checkstack/ui";

/**
 * Action primitives that this editor supports. The values match the
 * discriminator keys on `ActionInput` — checking for the matching key's
 * presence is how the schema itself distinguishes the variants.
 */
export type ActionKind =
  | "action"
  | "choose"
  | "parallel"
  | "repeat"
  | "variables"
  | "condition"
  | "stop"
  | "wait_for_trigger"
  | "wait_until"
  | "sequence"
  | "delay";

export const ACTION_KINDS: ActionKind[] = [
  "action",
  "choose",
  "parallel",
  "repeat",
  "variables",
  "condition",
  "stop",
  "wait_for_trigger",
  "wait_until",
  "sequence",
  "delay",
];

export interface ActionKindMeta {
  kind: ActionKind;
  label: string;
  description: string;
  icon: LucideIconName;
}

export const ACTION_KIND_META: Record<ActionKind, ActionKindMeta> = {
  action: {
    kind: "action",
    label: "Action",
    description: "Call a registered action (provider) by id.",
    // Not "Play": a play triangle reads as a run/test button, but this
    // icon sits inside the card's expand toggle, so clicking it just
    // collapses the card. "Zap" is the conventional automation-action
    // glyph and carries no "click to run" affordance.
    icon: "Zap",
  },
  choose: {
    kind: "choose",
    label: "Choose (if / else)",
    description: "Branch on a condition; first matching when-clause runs.",
    icon: "GitBranch",
  },
  parallel: {
    kind: "parallel",
    label: "Parallel",
    description: "Run branches concurrently; wait for all to complete.",
    icon: "Columns3",
  },
  repeat: {
    kind: "repeat",
    label: "Repeat",
    description: "Iterate (count / for_each / while / until).",
    icon: "Repeat",
  },
  variables: {
    kind: "variables",
    label: "Variables",
    description: "Define local var.* names for downstream actions.",
    icon: "Variable",
  },
  condition: {
    kind: "condition",
    label: "Condition (guard)",
    description: "Halt the run unless the condition holds.",
    icon: "Shield",
  },
  stop: {
    kind: "stop",
    label: "Stop",
    description: "Terminate the run with an optional reason.",
    icon: "Square",
  },
  wait_for_trigger: {
    kind: "wait_for_trigger",
    label: "Wait for trigger",
    description: "Suspend until a matching trigger event arrives.",
    icon: "Hourglass",
  },
  wait_until: {
    kind: "wait_until",
    label: "Wait until",
    description: "Suspend until a condition becomes true, with optional timeout.",
    icon: "TimerReset",
  },
  sequence: {
    kind: "sequence",
    label: "Sequence",
    description: "Group several actions as one (useful inside parallel).",
    icon: "List",
  },
  delay: {
    kind: "delay",
    label: "Delay",
    description: "Sleep for a fixed or templated number of seconds.",
    icon: "Timer",
  },
};

/**
 * Inspect an `ActionInput` and return the discriminator key. The schema
 * deliberately uses structural discrimination (presence of `action`,
 * `choose`, `parallel`, …) rather than a `kind:` tag, so this central
 * helper is the only place that needs to know that fact.
 */
export function actionKindOf(action: ActionInput): ActionKind {
  if ("action" in action) return "action";
  if ("choose" in action) return "choose";
  if ("parallel" in action) return "parallel";
  if ("repeat" in action) return "repeat";
  if ("variables" in action) return "variables";
  if ("condition" in action) return "condition";
  if ("stop" in action) return "stop";
  if ("wait_for_trigger" in action) return "wait_for_trigger";
  if ("wait_until" in action) return "wait_until";
  if ("sequence" in action) return "sequence";
  return "delay";
}

const BASE = { enabled: true, continue_on_error: false } as const;

/**
 * Build a fresh action of the requested kind with sensible empty defaults.
 * Used when the operator picks a building block from the add-step picker.
 *
 * Composite kinds (choose / parallel / repeat / sequence) start with an
 * empty child list; the operator fills them via the nested add-step picker.
 * The schema requires at least one nested step, so an empty composite surfaces
 * an inline "add a step" validation hint until the operator adds one - which
 * is clearer than seeding an unconfigurable empty provider action now that the
 * in-card action switcher is gone.
 */
export function makeEmptyAction(kind: ActionKind): ActionInput {
  switch (kind) {
    case "action": {
      return { ...BASE, action: "", config: {} } satisfies ProviderAction;
    }
    case "choose": {
      return {
        ...BASE,
        choose: [{ when: "", sequence: [] }],
      } satisfies ChooseInput;
    }
    case "parallel": {
      return {
        ...BASE,
        parallel: [],
      } satisfies ParallelInput;
    }
    case "repeat": {
      return {
        ...BASE,
        repeat: { count: 3, sequence: [] },
      } satisfies RepeatInput;
    }
    case "variables": {
      return {
        ...BASE,
        variables: { example: "value" },
      } satisfies VariablesInput;
    }
    case "condition": {
      return { ...BASE, condition: "" } satisfies ConditionGuardInput;
    }
    case "stop": {
      return { ...BASE, stop: { error: false } } satisfies StopInput;
    }
    case "wait_for_trigger": {
      return {
        ...BASE,
        wait_for_trigger: { event: "" },
      } satisfies WaitForTriggerInput;
    }
    case "wait_until": {
      return {
        ...BASE,
        wait_until: {
          condition: "",
          continue_on_timeout: true,
        },
      } satisfies WaitUntilInput;
    }
    case "sequence": {
      return {
        ...BASE,
        sequence: [],
      } satisfies SequenceInput;
    }
    case "delay": {
      return { ...BASE, delay: { seconds: 30 } } satisfies DelayInput;
    }
  }
}

/**
 * Build a fresh provider-action step with its `action` preset to a chosen
 * registered action's fully-qualified id. Used by the add-step picker so the
 * operator selects the concrete action up front (the kind is fixed at
 * creation). The empty `config` is seeded with the action's schema defaults
 * by `DynamicForm` when the card renders.
 */
export function makeProviderAction(qualifiedId: string): ProviderAction {
  return { ...BASE, action: qualifiedId, config: {} } satisfies ProviderAction;
}

/**
 * Coerce an arbitrary string into an identifier-safe action id matching the
 * schema rule `/^[a-zA-Z_][a-zA-Z0-9_]*$/`: non-identifier characters
 * collapse to `_`, surrounding underscores are trimmed, and a leading digit
 * is prefixed with `_`. Empty input falls back to `action`.
 */
function slugifyId(raw: string): string {
  const cleaned = raw.replaceAll(/[^a-zA-Z0-9_]+/g, "_").replaceAll(/^_+|_+$/g, "");
  const base = cleaned.length > 0 ? cleaned : "action";
  return /^[0-9]/.test(base) ? `_${base}` : base;
}

/**
 * Base for an action's auto-suggested id. Provider actions use the local
 * action name (the part after the plugin dot, e.g.
 * `integration-jira.create_issue` -> `create_issue`); every other kind uses
 * its kind name. Falls back to the kind when a provider action has not been
 * picked yet.
 */
export function suggestActionIdBase(action: ActionInput): string {
  if ("action" in action) {
    const qualified = action.action;
    const local = qualified.includes(".")
      ? qualified.slice(qualified.lastIndexOf(".") + 1)
      : qualified;
    return slugifyId(local || "action");
  }
  return slugifyId(actionKindOf(action));
}

/** Child action lists a composite action contains (empty for leaf kinds). */
function childActionLists(action: ActionInput): ActionInput[][] {
  if ("choose" in action) {
    const lists = action.choose.map((branch) => branch.sequence);
    if (action.else) lists.push(action.else);
    return lists;
  }
  if ("parallel" in action) return [action.parallel];
  if ("repeat" in action) return [action.repeat.sequence];
  if ("sequence" in action) return [action.sequence];
  return [];
}

/**
 * Recursively collect every assigned action id across a tree of actions.
 * Used to seed uniqueness when auto-assigning default ids.
 */
export function collectActionIds(
  actions: ActionInput[],
  into: Set<string> = new Set(),
): Set<string> {
  for (const action of actions) {
    if (typeof action.id === "string" && action.id.length > 0) {
      into.add(action.id);
    }
    for (const list of childActionLists(action)) collectActionIds(list, into);
  }
  return into;
}

/** Make `base` unique against `taken`, appending `_2`, `_3`, ... as needed. */
function uniqueId(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}_${n}`)) n += 1;
  return `${base}_${n}`;
}

/**
 * A single identifier-safe, unique default id for `action`, deduped against
 * `taken`. Used by the editor to re-fill the Id field when an operator clears
 * it, so every action always carries a log-friendly, referenceable id.
 */
export function defaultActionId(
  action: ActionInput,
  taken: Set<string>,
): string {
  return uniqueId(suggestActionIdBase(action), taken);
}

/**
 * Return a copy of `actions` with a stable, unique, identifier-safe `id`
 * assigned to every action (and nested action) that does not already have
 * one. `taken` seeds the uniqueness set with ids used elsewhere in the
 * automation and is mutated as ids are assigned.
 *
 * Called when adding a step so freshly-created actions - including the
 * children that composite kinds prime themselves with - always carry a
 * log-friendly id the operator can rename. Operators are not forced to name
 * every step, but every run-step then has a parseable id in the logs.
 */
export function assignDefaultIds(
  actions: ActionInput[],
  taken: Set<string>,
): ActionInput[] {
  return actions.map((action) => {
    const id =
      typeof action.id === "string" && action.id.length > 0
        ? action.id
        : uniqueId(suggestActionIdBase(action), taken);
    taken.add(id);
    const next = { ...action, id };
    if ("choose" in next) {
      return {
        ...next,
        choose: next.choose.map((branch) => ({
          ...branch,
          sequence: assignDefaultIds(branch.sequence, taken),
        })),
        else: next.else ? assignDefaultIds(next.else, taken) : undefined,
      };
    }
    if ("parallel" in next) {
      return { ...next, parallel: assignDefaultIds(next.parallel, taken) };
    }
    if ("repeat" in next) {
      return {
        ...next,
        repeat: {
          ...next.repeat,
          sequence: assignDefaultIds(next.repeat.sequence, taken),
        },
      };
    }
    if ("sequence" in next) {
      return { ...next, sequence: assignDefaultIds(next.sequence, taken) };
    }
    return next;
  });
}

/**
 * Produce a duplicate of `action` (and every nested child) with FRESH, unique,
 * identifier-safe ids, deduped against `taken`. Unlike {@link assignDefaultIds}
 * - which preserves existing ids and only fills blanks - this strips every id
 * so a duplicated step never collides with its original. `taken` is mutated as
 * ids are assigned, so callers can clone several actions against one set.
 *
 * Used by the per-card "Duplicate" command: clone the item, insert it directly
 * after the original, and keep the editor's parallel `ids` array in sync.
 */
export function duplicateAction(
  action: ActionInput,
  taken: Set<string>,
): ActionInput {
  // Strip ids top-down, then run the standard default-id assignment so the
  // clone (and its children) get brand-new unique ids rather than the
  // originals'.
  const stripIds = (input: ActionInput): ActionInput => {
    const { id: _id, ...rest } = input;
    const next = rest as ActionInput;
    if ("choose" in next) {
      return {
        ...next,
        choose: next.choose.map((branch) => ({
          ...branch,
          sequence: branch.sequence.map((child) => stripIds(child)),
        })),
        else: next.else
          ? next.else.map((child) => stripIds(child))
          : undefined,
      };
    }
    if ("parallel" in next) {
      return { ...next, parallel: next.parallel.map((child) => stripIds(child)) };
    }
    if ("repeat" in next) {
      return {
        ...next,
        repeat: {
          ...next.repeat,
          sequence: next.repeat.sequence.map((child) => stripIds(child)),
        },
      };
    }
    if ("sequence" in next) {
      return { ...next, sequence: next.sequence.map((child) => stripIds(child)) };
    }
    return next;
  };
  const [cloned] = assignDefaultIds([stripIds(action)], taken);
  return cloned!;
}

/**
 * Display-name for an action card's header. For provider actions we
 * fall back to the namespaced id when the registry doesn't know the
 * action (e.g. while listActions is still loading); for composite
 * actions we use the kind's friendly label.
 */
export function actionDisplayName(
  action: ActionInput,
  registryLookup: (qualifiedId: string) => string | undefined,
): string {
  const kind = actionKindOf(action);
  if (kind === "action") {
    const provider = action as ProviderAction;
    return (
      registryLookup(provider.action) ?? (provider.action || "Action")
    );
  }
  return ACTION_KIND_META[kind].label;
}
