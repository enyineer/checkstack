/* eslint-disable unicorn/no-null */
import { z } from "zod";

// ============================================================================
// OPERATOR ENUMS
// ============================================================================

/**
 * Operators for numeric comparisons.
 */
export const NumericOperators = z.enum([
  "equals",
  "notEquals",
  "lessThan",
  "lessThanOrEqual",
  "greaterThan",
  "greaterThanOrEqual",
]);

/**
 * Operators for time thresholds (typically only "less than" makes sense).
 */
export const TimeThresholdOperators = z.enum(["lessThan", "lessThanOrEqual"]);

/**
 * Operators for string matching.
 */
export const StringOperators = z.enum([
  "equals",
  "notEquals",
  "contains",
  "startsWith",
  "endsWith",
  "matches",
  "isEmpty",
]);

/**
 * Operators for boolean checks.
 */
export const BooleanOperators = z.enum(["isTrue", "isFalse"]);

/**
 * Universal operators for dynamic/unknown types (JSONPath values).
 * Works via runtime type coercion.
 */
export const DynamicOperators = z.enum([
  // String operators (always work)
  "equals",
  "notEquals",
  "contains",
  "startsWith",
  "endsWith",
  "matches",
  // Existence check
  "exists",
  "notExists",
  // Numeric operators (value coerced to number at runtime)
  "lessThan",
  "lessThanOrEqual",
  "greaterThan",
  "greaterThanOrEqual",
]);

// ============================================================================
// SCHEMA FACTORIES
// ============================================================================

/**
 * Creates an assertion schema for numeric fields with full comparison operators.
 */
export function numericField(
  name: string,
  config?: { min?: number; max?: number }
) {
  return z.object({
    field: z.literal(name),
    operator: NumericOperators,
    value: z
      .number()
      .min(config?.min ?? -Infinity)
      .max(config?.max ?? Infinity),
  });
}

/**
 * Creates an assertion schema for time threshold fields (latency, query time, etc).
 * Only supports "less than" operators since higher is typically worse.
 */
export function timeThresholdField(name: string) {
  return z.object({
    field: z.literal(name),
    operator: TimeThresholdOperators,
    value: z.number().min(0).describe("Threshold in milliseconds"),
  });
}

/**
 * Creates an assertion schema for string matching fields.
 */
export function stringField(name: string) {
  return z.object({
    field: z.literal(name),
    operator: StringOperators,
    value: z.string().optional().describe("Pattern (optional for isEmpty)"),
  });
}

/**
 * Creates an assertion schema for boolean fields.
 * Uses isTrue/isFalse operators to explicitly check expected value.
 */
export function booleanField(name: string) {
  return z.object({
    field: z.literal(name),
    operator: BooleanOperators,
    // No value needed - operator determines expected boolean
  });
}

/**
 * Creates an assertion schema for enum fields (e.g., status codes).
 */
export function enumField<T extends string>(
  name: string,
  values: readonly T[]
) {
  return z.object({
    field: z.literal(name),
    operator: z.literal("equals"),
    value: z.enum(values as [T, ...T[]]),
  });
}

/**
 * Creates an assertion schema for JSONPath fields with dynamic typing.
 * Type is unknown at config time, so we accept string values and coerce at runtime.
 */
export function jsonPathField() {
  return z.object({
    path: z
      .string()
      .describe("JSONPath expression (e.g. $.status, $.data[0].id)"),
    operator: DynamicOperators,
    value: z
      .string()
      .optional()
      .describe("Expected value (not needed for exists/notExists)"),
  });
}

// ============================================================================
// EVALUATION ENGINE
// ============================================================================

/**
 * Result of evaluating a single assertion.
 */
export interface AssertionResult {
  passed: boolean;
  field: string;
  operator?: string;
  expected?: unknown;
  actual?: unknown;
  message?: string;
}

/**
 * Evaluate a single assertion against actual values.
 */
export function evaluateAssertion<T extends { field: string }>(
  assertion: T,
  values: Record<string, unknown>
): AssertionResult {
  const field = assertion.field;
  const actual = values[field];

  const { operator, value: expected } = assertion as T & {
    operator: string;
    value?: unknown;
  };

  const passed = evaluateOperator(operator, actual, expected);

  return {
    passed,
    field,
    operator,
    expected,
    actual,
    message: passed
      ? undefined
      : formatFailureMessage(field, operator, expected, actual),
  };
}

/**
 * Evaluate all assertions, returning the first failure or null if all pass.
 */
export function evaluateAssertions<T extends { field: string }>(
  assertions: T[] | undefined,
  values: Record<string, unknown>
): T | null {
  if (!assertions?.length) return null;

  for (const assertion of assertions) {
    const result = evaluateAssertion(assertion, values);
    if (!result.passed) {
      return assertion;
    }
  }
  return null;
}

/**
 * Evaluate JSONPath assertions against a JSON object.
 * Requires a JSONPath extraction function to be passed in to avoid bundling jsonpath-plus.
 */
export function evaluateJsonPathAssertions<
  T extends { path: string; operator: string; value?: string }
>(
  assertions: T[] | undefined,
  json: unknown,
  extractPath: (path: string, json: unknown) => unknown
): T | null {
  if (!assertions?.length) return null;

  for (const assertion of assertions) {
    const extractedValue = extractPath(assertion.path, json);
    const passed = evaluateOperator(
      assertion.operator,
      extractedValue,
      assertion.value
    );

    if (!passed) return assertion;
  }
  return null;
}

// ============================================================================
// INTERNAL HELPERS
// ============================================================================

/**
 * Evaluate an operator against actual and expected values.
 */
function evaluateOperator(
  op: string,
  actual: unknown,
  expected: unknown
): boolean {
  // Existence checks
  if (op === "exists") return actual !== undefined && actual !== null;
  if (op === "notExists") return actual === undefined || actual === null;

  // Boolean operators
  if (op === "isTrue") return actual === true;
  if (op === "isFalse") return actual === false;

  // Empty check
  if (op === "isEmpty") return !actual || String(actual).trim() === "";

  // For numeric operators, try to coerce to numbers
  if (
    [
      "lessThan",
      "lessThanOrEqual",
      "greaterThan",
      "greaterThanOrEqual",
    ].includes(op)
  ) {
    const numActual = Number(actual);
    const numExpected = Number(expected);
    if (Number.isNaN(numActual) || Number.isNaN(numExpected)) return false;

    switch (op) {
      case "lessThan": {
        return numActual < numExpected;
      }
      case "lessThanOrEqual": {
        return numActual <= numExpected;
      }
      case "greaterThan": {
        return numActual > numExpected;
      }
      case "greaterThanOrEqual": {
        return numActual >= numExpected;
      }
    }
  }

  // String operators (coerce to string)
  const strActual = String(actual ?? "");
  const strExpected = String(expected ?? "");

  switch (op) {
    case "equals": {
      // Try numeric equality first, then strict equality, then string equality
      if (typeof actual === "number" && typeof expected === "number") {
        return actual === expected;
      }
      if (actual === expected) return true;
      return strActual === strExpected;
    }
    case "notEquals": {
      if (actual === expected) return false;
      return strActual !== strExpected;
    }
    case "contains": {
      return strActual.includes(strExpected);
    }
    case "startsWith": {
      return strActual.startsWith(strExpected);
    }
    case "endsWith": {
      return strActual.endsWith(strExpected);
    }
    case "matches": {
      try {
        return new RegExp(strExpected).test(strActual);
      } catch {
        return false;
      }
    }
    default: {
      return false;
    }
  }
}

/**
 * Format a human-readable failure message.
 */
function formatFailureMessage(
  field: string,
  operator: string,
  expected: unknown,
  actual: unknown
): string {
  const opLabels: Record<string, string> = {
    equals: "to equal",
    notEquals: "not to equal",
    lessThan: "to be less than",
    lessThanOrEqual: "to be at most",
    greaterThan: "to be greater than",
    greaterThanOrEqual: "to be at least",
    contains: "to contain",
    startsWith: "to start with",
    endsWith: "to end with",
    matches: "to match pattern",
    isEmpty: "to be empty",
    exists: "to exist",
    notExists: "not to exist",
    isTrue: "to be true",
    isFalse: "to be false",
  };

  const opLabel = opLabels[operator] || operator;

  // For operators without expected values
  if (
    ["isEmpty", "exists", "notExists", "isTrue", "isFalse"].includes(operator)
  ) {
    return `${field}: expected ${opLabel}, got ${JSON.stringify(actual)}`;
  }

  return `${field}: expected ${opLabel} ${JSON.stringify(
    expected
  )}, got ${JSON.stringify(actual)}`;
}
