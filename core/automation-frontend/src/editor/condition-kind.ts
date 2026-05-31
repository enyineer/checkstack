/**
 * Pure helpers for the structured `ConditionEditor` - kept free of any
 * React / `@checkstack/ui` imports so they can be unit-tested under bun
 * (the UI barrel drags Monaco's vscode-only modules, which break bun's
 * test runner).
 */
import type { ConditionInput } from "@checkstack/automation-common";
import type { LucideIconName } from "@checkstack/ui";

export type ConditionKind =
  | "expr"
  | "and"
  | "or"
  | "not"
  | "numeric_state"
  | "time"
  | "state";

/** Picker groups, mirroring the structured / logical / advanced split. */
export type ConditionKindGroup = "Structured" | "Logical" | "Advanced";

export interface ConditionKindMeta {
  kind: ConditionKind;
  label: string;
  description: string;
  icon: LucideIconName;
  group: ConditionKindGroup;
}

/**
 * The only "registry" conditions have: per-kind labels, descriptions, icons
 * and picker groups. Single source of truth for the condition type picker
 * (and the labels mirror the `ConditionEditor` kind selector). Every
 * {@link ConditionKind} has exactly one entry.
 */
export const CONDITION_KIND_META: Record<ConditionKind, ConditionKindMeta> = {
  numeric_state: {
    kind: "numeric_state",
    label: "numeric state",
    description: "Compare a numeric value (path or template) to a threshold.",
    icon: "Gauge",
    group: "Structured",
  },
  time: {
    kind: "time",
    label: "time of day",
    description: "Gate on a time window, weekdays and timezone.",
    icon: "Clock",
    group: "Structured",
  },
  state: {
    kind: "state",
    label: "system state",
    description: "Require a system's status (with optional dwell).",
    icon: "Activity",
    group: "Structured",
  },
  and: {
    kind: "and",
    label: "and",
    description: "All child conditions must hold.",
    icon: "Ampersand",
    group: "Logical",
  },
  or: {
    kind: "or",
    label: "or",
    description: "At least one child condition must hold.",
    icon: "GitBranch",
    group: "Logical",
  },
  not: {
    kind: "not",
    label: "not",
    description: "Negate a single child condition.",
    icon: "Ban",
    group: "Logical",
  },
  expr: {
    kind: "expr",
    label: "expression",
    description: "Raw boolean expression — the escape hatch.",
    icon: "Braces",
    group: "Advanced",
  },
};

/** Discriminate a condition into its editor kind. */
export function kindOf(condition: ConditionInput): ConditionKind {
  if (typeof condition === "string") return "expr";
  if ("and" in condition) return "and";
  if ("or" in condition) return "or";
  if ("not" in condition) return "not";
  if ("numeric_state" in condition) return "numeric_state";
  if ("time" in condition) return "time";
  return "state";
}

/**
 * Seed value when the operator switches a condition to a given kind.
 * Structured kinds seed schema-valid defaults so a freshly-added
 * structured condition round-trips through zod / YAML without error;
 * the bare `expr` / combinator seeds use empty strings the operator
 * fills in (the editor surfaces a validation hint until then).
 */
export function defaultForKind(kind: ConditionKind): ConditionInput {
  switch (kind) {
    case "expr": {
      return "";
    }
    case "and": {
      return { and: [""] };
    }
    case "or": {
      return { or: [""] };
    }
    case "not": {
      return { not: "" };
    }
    case "numeric_state": {
      return { numeric_state: { value: "", above: 0 } };
    }
    case "time": {
      return { time: { after: "09:00", before: "17:00" } };
    }
    case "state": {
      return { state: { entity: "", status: "unhealthy" } };
    }
  }
}
