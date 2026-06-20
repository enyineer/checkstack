import type { JsonSchema, JsonSchemaProperty } from "./types";

/**
 * Cleans a description string by removing textarea markers.
 * Returns undefined if the description is empty or just "textarea".
 */
export const getCleanDescription = (
  description?: string,
): string | undefined => {
  if (!description || description === "textarea") return;
  const cleaned = description.replace("[textarea]", "").trim();
  if (!cleaned) return;
  return cleaned;
};

/**
 * Extracts default values from a JSON schema recursively.
 */
export const extractDefaults = (
  schema: JsonSchema,
): Record<string, unknown> => {
  const defaults: Record<string, unknown> = {};

  if (!schema.properties) return defaults;

  for (const [key, propSchema] of Object.entries(schema.properties)) {
    if (propSchema.default !== undefined) {
      defaults[key] = propSchema.default;
    } else if (propSchema.type === "object" && propSchema.properties) {
      // Recursively extract defaults for nested objects
      defaults[key] = extractDefaults(propSchema as JsonSchema);
    } else if (propSchema.type === "array") {
      // Arrays default to empty array
      defaults[key] = [];
    }
  }

  return defaults;
};

/**
 * Check if a value is considered "empty" for validation purposes.
 * Used to determine if required fields are filled.
 */
export function isValueEmpty(
  val: unknown,
  propSchema: JsonSchemaProperty,
): boolean {
  if (val === undefined || val === null) return true;
  if (typeof val === "string" && val.trim() === "") return true;
  // For arrays, only consider empty if schema requires minimum items
  if (Array.isArray(val) && val.length === 0) {
    const minItems = (propSchema as JsonSchemaProperty & { minItems?: number }).minItems;
    if (minItems !== undefined && minItems > 0) return true;
    // Empty arrays are valid by default (e.g., optional mappings lists)
    return false;
  }
  // For objects (nested schemas), recursively check required fields
  if (propSchema.type === "object" && propSchema.properties) {
    const objVal = val as Record<string, unknown>;
    const requiredKeys = propSchema.required ?? [];
    for (const key of requiredKeys) {
      const nestedPropSchema = propSchema.properties[key];
      if (nestedPropSchema && isValueEmpty(objVal[key], nestedPropSchema)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Whether a nested object's schema-required children should display the
 * required `*` marker. A REQUIRED nested object always marks its required
 * children. An OPTIONAL nested object (e.g. an opt-in spend cap) only marks
 * them once the operator is actually providing the object (any child has a
 * non-empty value) — while it is empty, supplying it is optional, so its
 * children must not show `*` (the form is valid without any of them).
 */
export function nestedChildrenRequired({
  objectRequired,
  objectValue,
}: {
  objectRequired: boolean;
  objectValue: unknown;
}): boolean {
  if (objectRequired) return true;
  if (objectValue === null || typeof objectValue !== "object") return false;
  return Object.values(objectValue as Record<string, unknown>).some(
    (entry) => entry !== undefined && entry !== null && entry !== "",
  );
}

/**
 * Locate the value of the secret→env mapping field within an object's
 * properties by the `x-secret-env` annotation (NOT by a hard-coded field
 * name), and return it. Used to feed the inline script-test panel the same
 * `secretEnv` the sibling action declares, so a test injects placeholders /
 * overrides for those secrets. Returns `undefined` when no `x-secret-env`
 * field exists or its value isn't a record.
 */
export function findSecretEnvSibling({
  properties,
  values,
}: {
  properties: Record<string, JsonSchemaProperty> | undefined;
  values: Record<string, unknown> | undefined;
}): Record<string, string> | undefined {
  if (!properties || !values) return undefined;
  for (const [key, propSchema] of Object.entries(properties)) {
    if (propSchema["x-secret-env"] === true) {
      const value = values[key];
      if (value && typeof value === "object" && !Array.isArray(value)) {
        const record: Record<string, string> = {};
        for (const [k, v] of Object.entries(value)) {
          if (typeof v === "string") record[k] = v;
        }
        return record;
      }
      return undefined;
    }
  }
  return undefined;
}

/**
 * Coerce a number/integer `<input>`'s raw string value into the form value.
 *
 * An empty input maps to `undefined` (not `NaN`), so the required-field path
 * handles emptiness rather than letting a `NaN` leak into form state. A
 * partially-typed value that does not yet parse to a finite number (e.g. "-",
 * "1.", "1e") also maps to `undefined` instead of `NaN`, so the field does not
 * thrash while typing. Only a value that parses to a finite number is coerced.
 */
export function coerceNumberInput({
  raw,
  isInteger,
}: {
  raw: string;
  isInteger: boolean;
}): number | undefined {
  if (raw.trim() === "") return undefined;
  const parsed = isInteger ? Number.parseInt(raw, 10) : Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Whether an array item is "non-trivial" — i.e. it holds at least one
 * user-entered value and therefore removing it warrants a confirmation gate.
 *
 * A just-added / empty row (all fields blank: `undefined`, `null`, empty/
 * whitespace string, empty array, or an object whose own values are all
 * trivial) is trivial, so it can be removed immediately without an annoying
 * confirm. Primitives that are blank are trivial; any other primitive
 * (including `false` and `0`) counts as a deliberately entered value.
 */
export function isArrayItemNonTrivial(item: unknown): boolean {
  if (item === undefined || item === null) return false;
  if (typeof item === "string") return item.trim() !== "";
  if (Array.isArray(item)) {
    return item.some((entry) => isArrayItemNonTrivial(entry));
  }
  if (typeof item === "object") {
    return Object.values(item).some((entry: unknown) =>
      isArrayItemNonTrivial(entry),
    );
  }
  // Numbers, booleans, bigints, etc. are deliberate values.
  return true;
}

/** Sentinel value used to represent "None" selection in Select components */
export const NONE_SENTINEL = "__none__";

/**
 * Evaluate x-hidden-when conditions against current form values.
 * Returns true if the field should be hidden.
 *
 * Each condition maps a sibling field name to values that trigger hiding.
 * The field is hidden if ANY condition matches (OR semantics).
 */
export function isFieldHiddenByCondition(
  conditions: Record<string, string[]>,
  formValues: Record<string, unknown>,
): boolean {
  return Object.entries(conditions).some(([field, values]) =>
    values.includes(String(formValues[field] ?? "")),
  );
}

/**
 * Converts a select value to the actual form value.
 * Handles the "None" sentinel value by returning undefined.
 */
export function parseSelectValue(val: string): string | undefined {
  return val === NONE_SENTINEL ? undefined : val;
}

// =============================================================================
// Multi-Type Editor Utilities
// =============================================================================

import type { KeyValuePair } from "./KeyValueEditor";
import type { EditorType } from "@checkstack/common";

// Re-export for local consumers
export type { EditorType } from "@checkstack/common";

/**
 * Serialize key-value pairs to URL-encoded string format.
 * Example: [{ key: "a", value: "1" }] -> "a=1"
 */
export function serializeFormData(pairs: KeyValuePair[]): string {
  const filtered = pairs.filter((p) => p.key.trim() !== "");
  if (filtered.length === 0) return "";
  return filtered
    .map((p) => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`)
    .join("&");
}

/**
 * Parse URL-encoded string to key-value pairs.
 * Example: "a=1&b=2" -> [{ key: "a", value: "1" }, { key: "b", value: "2" }]
 */
export function parseFormData(str: string): KeyValuePair[] {
  if (!str || str.trim() === "") return [];

  return str.split("&").map((pair) => {
    const [key, ...valueParts] = pair.split("=");
    return {
      key: decodeURIComponent(key || ""),
      value: decodeURIComponent(valueParts.join("=") || ""),
    };
  });
}

/**
 * Detect the most likely editor type from a string value.
 * Used to auto-select the initial editor type when loading existing data.
 */
export function detectEditorType(
  value: string | undefined,
  availableTypes: EditorType[],
): EditorType {
  // If no value, prefer "none" if available, otherwise first type
  if (!value || value.trim() === "") {
    if (availableTypes.includes("none")) return "none";
    return availableTypes[0] ?? "raw";
  }

  // Try to detect JSON
  if (availableTypes.includes("json")) {
    const trimmed = value.trim();
    if (
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"))
    ) {
      try {
        JSON.parse(value);
        return "json";
      } catch {
        // Not valid JSON, continue checking
      }
    }
  }

  // Try to detect formdata (URL-encoded key=value pairs)
  // Simple heuristic: contains = and optionally &, no newlines
  if (
    availableTypes.includes("formdata") &&
    value.includes("=") &&
    !value.includes("\n")
  ) {
    const parts = value.split("&");
    const looksLikeFormData = parts.every((p) => p.includes("="));
    if (looksLikeFormData) {
      return "formdata";
    }
  }

  // Default to raw if available
  if (availableTypes.includes("raw")) return "raw";

  // Fallback to first available type
  return availableTypes[0] ?? "raw";
}

/**
 * Human-readable labels for editor types
 */
export const EDITOR_TYPE_LABELS: Record<EditorType, string> = {
  none: "None",
  raw: "Plain Text",
  json: "JSON",
  yaml: "YAML",
  xml: "XML",
  markdown: "Markdown",
  formdata: "Form Data",
  javascript: "JavaScript",
  typescript: "TypeScript",
  shell: "Shell",
};
