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
  if ("sequence" in action) return "sequence";
  return "delay";
}

const BASE = { enabled: true, continue_on_error: false } as const;

/**
 * Build a fresh action of the requested kind with sensible empty
 * defaults. Used when the operator picks a kind from the action-add
 * popover or changes the kind on an existing card.
 */
export function makeEmptyAction(kind: ActionKind): ActionInput {
  switch (kind) {
    case "action": {
      return { ...BASE, action: "", config: {} } satisfies ProviderAction;
    }
    case "choose": {
      return {
        ...BASE,
        choose: [{ when: "", sequence: [makeEmptyAction("action")] }],
      } satisfies ChooseInput;
    }
    case "parallel": {
      return {
        ...BASE,
        parallel: [makeEmptyAction("action")],
      } satisfies ParallelInput;
    }
    case "repeat": {
      return {
        ...BASE,
        repeat: { count: 3, sequence: [makeEmptyAction("action")] },
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
    case "sequence": {
      return {
        ...BASE,
        sequence: [makeEmptyAction("action")],
      } satisfies SequenceInput;
    }
    case "delay": {
      return { ...BASE, delay: { seconds: 30 } } satisfies DelayInput;
    }
  }
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
