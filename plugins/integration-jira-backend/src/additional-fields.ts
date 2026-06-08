/**
 * Coerce + VALIDATE operator-supplied `fieldMappings` (each a `{ fieldKey, value }`
 * where `value` is the rendered template STRING) into the JIRA-shaped values the
 * REST API expects, using the field metadata Jira itself returned from
 * create-meta (`JiraField` — `schema.type` / `schema.items` / `allowedValues`).
 *
 * Why this exists: the config value is always a string, but Jira fields are
 * typed — `labels` is an array of string, a story-points field is a number, a
 * select is `{ id }` from a fixed `allowedValues` set. Without coercion a string
 * is sent where Jira wants an array/number/object and the create fails with an
 * opaque 400. Validating against the live schema also lets us reject an unknown
 * field key or an out-of-set option value with a clear, actionable message
 * BEFORE the API call (the same metadata the field-discovery resolver surfaces).
 *
 * Pure (no I/O) so it is unit-testable; the caller fetches `JiraField[]` and
 * passes them in.
 */
import type { JiraField } from "@checkstack/integration-jira-common";

export interface FieldMapping {
  fieldKey: string;
  value: string;
}

type CoerceResult =
  | { ok: true; value: unknown }
  | { ok: false; error: string };

/** Resolve an option string to Jira's `{ id }` shape via the field's allowedValues. */
function toOption(
  raw: string,
  field: JiraField,
): { ok: true; value: { id: string } } | { ok: false; error: string } {
  const allowed = field.allowedValues ?? [];
  if (allowed.length === 0) {
    // No constrained set advertised; pass the raw value as a name reference.
    return { ok: true, value: { id: raw } };
  }
  const match = allowed.find(
    (a) => a.id === raw || a.name === raw || a.value === raw,
  );
  if (!match) {
    const names = allowed
      .map((a) => a.name ?? a.value ?? a.id)
      .filter((n): n is string => typeof n === "string")
      .join(", ");
    return {
      ok: false,
      error: `"${raw}" is not a valid value for "${field.name}". Allowed: ${names}.`,
    };
  }
  return { ok: true, value: { id: match.id } };
}

/** Jira `schema.type` values that are an array/object of selectable options. */
const OPTION_ITEM_TYPES = new Set(["option", "version", "component", "group"]);

/** Coerce one rendered string value to the field's Jira type (or report why not). */
export function coerceFieldValue(raw: string, field: JiraField): CoerceResult {
  const type = field.schema?.type ?? "string";
  const items = field.schema?.items;

  switch (type) {
    case "number": {
      const n = Number(raw);
      if (raw.trim() === "" || Number.isNaN(n)) {
        return { ok: false, error: `"${field.name}" expects a number, got "${raw}".` };
      }
      return { ok: true, value: n };
    }
    case "array": {
      // Accept a JSON array literal, otherwise treat the string as one element.
      let elements: unknown[];
      const trimmed = raw.trim();
      if (trimmed.startsWith("[")) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(trimmed);
        } catch {
          return { ok: false, error: `"${field.name}" expects a JSON array, got "${raw}".` };
        }
        elements = Array.isArray(parsed) ? parsed : [parsed];
      } else {
        elements = [raw];
      }
      if (items && OPTION_ITEM_TYPES.has(items)) {
        const out: Array<{ id: string }> = [];
        for (const element of elements) {
          const r = toOption(String(element), field);
          if (!r.ok) return r;
          out.push(r.value);
        }
        return { ok: true, value: out };
      }
      if (items === "number") {
        const nums = elements.map(Number);
        if (nums.some((n) => Number.isNaN(n))) {
          return { ok: false, error: `"${field.name}" expects an array of numbers, got "${raw}".` };
        }
        return { ok: true, value: nums };
      }
      return { ok: true, value: elements.map(String) };
    }
    case "option":
    case "priority":
    case "resolution": {
      return toOption(raw, field);
    }
    // string / date / datetime / text / any / and unknown types: pass through.
    default: {
      return { ok: true, value: raw };
    }
  }
}

/**
 * Coerce + validate every mapping against the live field metadata. Returns the
 * Jira-shaped `additionalFields` object plus any validation errors (unknown field
 * key, bad option value, type mismatch). The caller should fail the action when
 * `errors` is non-empty rather than send a request Jira will reject.
 */
export function buildAdditionalFields({
  mappings,
  fields,
}: {
  mappings: FieldMapping[];
  fields: JiraField[];
}): { additionalFields: Record<string, unknown>; errors: string[] } {
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const additionalFields: Record<string, unknown> = {};
  const errors: string[] = [];
  for (const mapping of mappings) {
    const field = byKey.get(mapping.fieldKey);
    if (!field) {
      errors.push(
        `Unknown Jira field "${mapping.fieldKey}" for this project/issue type.`,
      );
      continue;
    }
    const result = coerceFieldValue(mapping.value, field);
    if (!result.ok) {
      errors.push(result.error);
      continue;
    }
    additionalFields[mapping.fieldKey] = result.value;
  }
  return { additionalFields, errors };
}
