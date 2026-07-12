/**
 * Pure logic for the assertion builder (DOM-free): metadata-aware field
 * extraction from a collector's result schema, sentence-style operator
 * options, seeding, validation, and duplicate detection.
 *
 * Persisted encodings are sacred: `AssertableField.path` (what gets stored in
 * `assertion.field`) uses exactly the historic dotted/`[*]`/`.$` scheme, and
 * operator VALUES are the canonical strings the backend engine switches on -
 * only the LABELS are new.
 */

import type {
  JsonSchemaBase,
  JsonSchemaPropertyBase,
} from "@checkstack/common";
import {
  computeAssertionKey,
  type CollectorAssertion,
} from "@checkstack/healthcheck-common";
import { OPERATOR_SENTENCE_LABELS } from "./assertion-display.logic";
import {
  DEFAULT_CHART_PRIORITY,
  formatFieldName,
} from "../auto-charts/schema-parser";

type JsonSchema = JsonSchemaBase<JsonSchemaPropertyBase>;
type JsonSchemaProperty = JsonSchemaPropertyBase;

export type AssertionFieldType =
  | "string"
  | "number"
  | "boolean"
  | "enum"
  | "array"
  | "jsonpath";

export interface AssertableField {
  /** Persisted `assertion.field` path - encoding unchanged from day one. */
  path: string;
  /** Human label: `x-chart-label`, else humanized from the key. */
  label: string;
  type: AssertionFieldType;
  enumValues?: unknown[];
  /** For jsonpath fields, the original field path (e.g. "body"). */
  sourceField?: string;
  /** Unit suffix for numeric value inputs (`x-chart-unit`, e.g. "ms"). */
  unit?: string;
  /** Prose label for a boolean's `true` (e.g. "successful"). */
  trueLabel?: string;
  /** Prose label for a boolean's `false` (e.g. "failing"). */
  falseLabel?: string;
  /** Picker sort weight (`x-chart-priority`); lower lists earlier. */
  priority: number;
  /** JSONPath fields are the power-user tier; grouped under "Advanced". */
  advanced: boolean;
}

/** The synthetic suffix marking a JSONPath assertion's field path. */
export const JSONPATH_FIELD_SUFFIX = ".$";

/** Operators that don't need a value input. */
export const VALUE_LESS_OPERATORS = new Set([
  "isEmpty",
  "isNotEmpty",
  "isTrue",
  "isFalse",
  "exists",
  "notExists",
]);

/**
 * Operators offered per field type. VALUES must match the backend engine's
 * switch cases exactly (see `core/backend-api/src/assertions.ts`).
 */
const OPERATORS: Record<AssertionFieldType, string[]> = {
  string: [
    "equals",
    "notEquals",
    "contains",
    "startsWith",
    "endsWith",
    "matches",
    "isEmpty",
  ],
  number: [
    "equals",
    "notEquals",
    "lessThan",
    "lessThanOrEqual",
    "greaterThan",
    "greaterThanOrEqual",
  ],
  boolean: ["isTrue", "isFalse"],
  enum: ["equals"],
  array: [
    "includes",
    "notIncludes",
    "lengthEquals",
    "lengthGreaterThan",
    "lengthLessThan",
    "isEmpty",
    "isNotEmpty",
    "exists",
    "notExists",
  ],
  jsonpath: [
    "exists",
    "notExists",
    // Empty = [] / {} / "". A missing path is also "empty": combine with an
    // `exists` assertion on the same path to require "present but empty".
    "isEmpty",
    "isNotEmpty",
    "equals",
    "notEquals",
    "contains",
    "greaterThan",
    "lessThan",
  ],
};

/** Read a string annotation off a serialized schema property, validated. */
function stringAnnotation(
  prop: JsonSchemaProperty,
  key: string,
): string | undefined {
  const value = (prop as Record<string, unknown>)[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function priorityAnnotation(prop: JsonSchemaProperty): number {
  const value = (prop as Record<string, unknown>)["x-chart-priority"];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : DEFAULT_CHART_PRIORITY;
}

function labelFor(prop: JsonSchemaProperty, key: string): string {
  return stringAnnotation(prop, "x-chart-label") ?? formatFieldName(key);
}

const joinLabel = (prefix: string, label: string) =>
  prefix ? `${prefix} › ${label}` : label;

/**
 * Extract assertable fields from a collector result schema (JSON Schema with
 * chart annotations). Field PATHS are byte-for-byte what the pre-redesign
 * extraction produced (they persist in stored assertions); labels, units,
 * boolean prose, priorities, and the advanced flag are read from the chart
 * annotations that already drive the auto-charts.
 */
export function extractAssertableFields({
  schema,
  pathPrefix = "",
  labelPrefix = "",
}: {
  schema: JsonSchema;
  pathPrefix?: string;
  labelPrefix?: string;
}): AssertableField[] {
  const fields: AssertableField[] = [];
  if (!schema.properties) return fields;

  for (const [key, prop] of Object.entries(schema.properties)) {
    const path = pathPrefix ? `${pathPrefix}.${key}` : key;
    const label = joinLabel(labelPrefix, labelFor(prop, key));
    const priority = priorityAnnotation(prop);
    const base = { path, label, priority, advanced: false } as const;

    // Enum before type: an annotated enum is still an enum.
    if (prop.enum && prop.enum.length > 0) {
      fields.push({ ...base, type: "enum", enumValues: prop.enum });
      continue;
    }

    switch (prop.type) {
      case "string": {
        if ((prop as Record<string, unknown>)["x-jsonpath"] === true) {
          fields.push({
            ...base,
            path: `${path}${JSONPATH_FIELD_SUFFIX}`,
            label,
            type: "jsonpath",
            sourceField: path,
            advanced: true,
          });
        }
        fields.push({ ...base, type: "string" });
        break;
      }
      case "number":
      case "integer": {
        fields.push({
          ...base,
          type: "number",
          unit: stringAnnotation(prop, "x-chart-unit"),
        });
        break;
      }
      case "boolean": {
        fields.push({
          ...base,
          type: "boolean",
          trueLabel: stringAnnotation(prop, "x-chart-true-label"),
          falseLabel: stringAnnotation(prop, "x-chart-false-label"),
        });
        break;
      }
      case "array": {
        fields.push({ ...base, type: "array" });
        if (
          prop.items &&
          typeof prop.items === "object" &&
          "properties" in prop.items
        ) {
          const items = prop.items as JsonSchemaProperty;
          if (items.properties) {
            fields.push(
              ...extractAssertableFields({
                schema: { properties: items.properties },
                pathPrefix: `${path}[*]`,
                labelPrefix: `${label} item`,
              }),
            );
          }
        }
        break;
      }
      case "object": {
        if (prop.properties) {
          fields.push(
            ...extractAssertableFields({
              schema: { properties: prop.properties },
              pathPrefix: path,
              labelPrefix: label,
            }),
          );
        }
        break;
      }
      default: {
        // Unknown type - treat as string for flexibility.
        if (prop.type) {
          fields.push({ ...base, type: "string" });
        }
      }
    }
  }

  // Picker order: plain fields by priority (then label), advanced last.
  return fields.toSorted((a, b) => {
    if (a.advanced !== b.advanced) return a.advanced ? 1 : -1;
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.label.localeCompare(b.label, undefined, { sensitivity: "base" });
  });
}

export interface OperatorOption {
  value: string;
  label: string;
}

/**
 * The operator options for one field, with sentence-infix labels ("must
 * <label>"). Boolean fields phrase their two operators with the collector's
 * own true/false prose ("be successful" / "be failing") - LABELS only, the
 * persisted operator strings stay `isTrue`/`isFalse`.
 */
export function operatorOptionsForField({
  field,
}: {
  field: AssertableField;
}): OperatorOption[] {
  return OPERATORS[field.type].map((value) => {
    if (field.type === "boolean") {
      if (value === "isTrue" && field.trueLabel) {
        return { value, label: `be ${field.trueLabel}` };
      }
      if (value === "isFalse" && field.falseLabel) {
        return { value, label: `be ${field.falseLabel}` };
      }
    }
    return { value, label: OPERATOR_SENTENCE_LABELS[value] ?? value };
  });
}

/** Look up a field by its persisted path. */
export function findFieldByPath({
  fields,
  path,
}: {
  fields: AssertableField[];
  path: string;
}): AssertableField | undefined {
  return fields.find((f) => f.path === path);
}

/**
 * Seed a new assertion from the most useful field: the highest-priority
 * non-advanced one (extraction order), never a JSONPath row.
 */
export function seedAssertion({
  fields,
}: {
  fields: AssertableField[];
}): CollectorAssertion | undefined {
  const field = fields.find((f) => !f.advanced) ?? fields[0];
  if (!field) return;
  const [firstOperator] = OPERATORS[field.type];
  return { field: field.path, operator: firstOperator, value: undefined };
}

/**
 * Validate one assertion against the known fields. Returns a human message
 * describing what's missing/wrong, or `undefined` when the assertion is
 * complete and savable.
 */
export function validateAssertion({
  assertion,
  fields,
}: {
  assertion: CollectorAssertion;
  fields: AssertableField[];
}): string | undefined {
  const field = findFieldByPath({ fields, path: assertion.field });
  if (!field) return "Pick a field to check";

  if (!OPERATORS[field.type].includes(assertion.operator)) {
    return "Pick a condition";
  }

  if (field.type === "jsonpath") {
    const path = assertion.jsonPath?.trim();
    if (!path) return "Enter a JSONPath expression, e.g. $.status";
    if (!path.startsWith("$")) return "A JSONPath expression starts with $";
  }

  if (VALUE_LESS_OPERATORS.has(assertion.operator)) return;

  const value = assertion.value;
  if (value === undefined || value === "") return "Enter a value to compare against";
  if (field.type === "number" && !Number.isFinite(Number(value))) {
    return "Enter a number";
  }
  if (assertion.operator === "matches") {
    try {
      new RegExp(String(value));
    } catch {
      return "Enter a valid regular expression";
    }
  }
  return;
}

/**
 * Indexes of assertions that duplicate an EARLIER one (same canonical
 * identity key). The first occurrence is never flagged.
 */
export function duplicateAssertionIndexes({
  assertions,
}: {
  assertions: CollectorAssertion[];
}): Set<number> {
  const seen = new Set<string>();
  const duplicates = new Set<number>();
  for (const [index, assertion] of assertions.entries()) {
    const key = computeAssertionKey({ assertion });
    if (seen.has(key)) duplicates.add(index);
    seen.add(key);
  }
  return duplicates;
}

/** Are ALL assertions complete? (An empty list is valid.) */
export function assertionsAreValid({
  assertions,
  fields,
}: {
  assertions: CollectorAssertion[];
  fields: AssertableField[];
}): boolean {
  return assertions.every(
    (assertion) => validateAssertion({ assertion, fields }) === undefined,
  );
}
