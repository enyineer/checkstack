/**
 * Condition evaluation for the dispatch engine.
 *
 * Conditions come in two shapes from the schema:
 *
 *   - A template string returning truthy/falsy.
 *   - A combinator object — `{ and: [...] }`, `{ or: [...] }`, or
 *     `{ not: condition }` — recursing into nested conditions.
 *
 * Both forms eval against the current dispatch scope through the shared
 * template engine.
 */
import {
  evaluateBoolean,
  parseCondition,
  type FilterRegistry,
  type TemplateContext,
} from "@checkstack/template-engine";
import type { Condition } from "@checkstack/automation-common";

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
  // not
  return !evaluateCondition(condition.not, context, filters);
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
