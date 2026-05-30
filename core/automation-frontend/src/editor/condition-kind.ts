/**
 * Pure helpers for the structured `ConditionEditor` - kept free of any
 * React / `@checkstack/ui` imports so they can be unit-tested under bun
 * (the UI barrel drags Monaco's vscode-only modules, which break bun's
 * test runner).
 */
import type { ConditionInput } from "@checkstack/automation-common";

export type ConditionKind =
  | "expr"
  | "and"
  | "or"
  | "not"
  | "numeric_state"
  | "time"
  | "state";

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
