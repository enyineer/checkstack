/**
 * Condition evaluation for the dispatch engine.
 *
 * Conditions come in several shapes from the schema:
 *
 *   - A template string returning truthy/falsy.
 *   - A combinator object — `{ and: [...] }`, `{ or: [...] }`, or
 *     `{ not: condition }` — recursing into nested conditions.
 *   - A structured variant — `{ numeric_state }`, `{ time }`, `{ state }`.
 *
 * All forms eval against the current dispatch scope through the shared
 * template engine. Structured variants additionally compute a fresh `now`
 * per evaluation (the `time` variant) rather than reading scope `now`.
 */
import {
  evaluateBoolean,
  parseCondition,
  type FilterRegistry,
  type TemplateContext,
} from "@checkstack/template-engine";
import type { Condition } from "@checkstack/automation-common";

import {
  evaluateNumericStateCondition,
  evaluateStateCondition,
  evaluateTimeCondition,
} from "./structured-conditions";

/**
 * Evaluate a condition to boolean.
 *
 * Pure functions of the scope — no side effects, no async work. Throws
 * if a template fails to parse; callers convert that to a step failure.
 */
export function evaluateCondition(
  condition: Condition,
  context: TemplateContext,
  filters: FilterRegistry,
): boolean {
  if (typeof condition === "string") {
    return evaluateBoolean(parseCondition(condition), context, { filters });
  }
  if ("and" in condition) {
    return condition.and.every((c) =>
      evaluateCondition(c, context, filters),
    );
  }
  if ("or" in condition) {
    return condition.or.some((c) => evaluateCondition(c, context, filters));
  }
  if ("not" in condition) {
    return !evaluateCondition(condition.not, context, filters);
  }
  if ("numeric_state" in condition) {
    return evaluateNumericStateCondition(condition, context, filters);
  }
  if ("time" in condition) {
    // Fresh `now` per evaluation (constraint 7) — time-of-day gating must
    // never read the frozen scope timestamp.
    return evaluateTimeCondition(condition, new Date());
  }
  // state
  return evaluateStateCondition(condition, context);
}

/**
 * Evaluate every condition in a list. Returns the first failing
 * condition's index (or `-1` when all pass) so the caller can log which
 * gate rejected the run.
 */
export function evaluateAllConditions(
  conditions: ReadonlyArray<Condition>,
  context: TemplateContext,
  filters: FilterRegistry,
): number {
  for (const [i, condition] of conditions.entries()) {
    if (!evaluateCondition(condition, context, filters)) return i;
  }
  return -1;
}
