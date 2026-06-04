import { z } from "zod";

import type { JsonSchema, JsonSchemaProperty } from "./types";
import { isValueEmpty, isFieldHiddenByCondition } from "./utils";

/**
 * A map from a field path to a human-readable validation message. The path
 * is dot-joined (e.g. `spendCap.tokenBudget`) so it lines up with the keys
 * DynamicForm renders for nested object fields. The top-level segment is
 * always the form field DynamicForm shows; nested segments identify the
 * offending sub-field for the message text.
 */
export type FieldErrorMap = Record<string, string>;

/**
 * Zod schema for a single zod issue as it crosses the oRPC boundary. The
 * backend attaches the original `ZodError.issues` array to the
 * `ORPCError.data` payload; oRPC serializes it to JSON and the client
 * deserializes it, so we re-parse it here rather than trusting its shape.
 * Only the fields we actually consume are required.
 */
const serverZodIssueSchema = z.object({
  path: z.array(z.union([z.string(), z.number()])),
  message: z.string(),
});

/**
 * Zod schema for the structured validation payload the backend places on
 * `ORPCError.data` for connection-config validation failures. `code`
 * discriminates this payload from any other structured error data so we
 * never mis-map an unrelated error onto form fields.
 */
export const serverValidationDataSchema = z.object({
  code: z.literal("CONFIG_VALIDATION"),
  issues: z.array(serverZodIssueSchema),
});

export type ServerValidationData = z.infer<typeof serverValidationDataSchema>;

/**
 * Parse an unknown error payload (typically `error.data` from an oRPC
 * `ORPCError`) into the structured connection-config validation shape.
 * Returns `undefined` when the payload is not structured config-validation
 * data, signalling the caller to fall back to a toast/banner.
 */
export function parseServerValidationData(
  data: unknown,
): ServerValidationData | undefined {
  const result = serverValidationDataSchema.safeParse(data);
  return result.success ? result.data : undefined;
}

/**
 * Map a structured server validation payload onto DynamicForm field paths.
 *
 * Each zod issue's `path` is joined with dots to form a field path. Only
 * issues whose first path segment names a property that actually exists in
 * the rendered schema are considered "mappable"; everything else (empty
 * paths, unknown roots) is reported back as `unmapped` so the caller can
 * surface it via the existing toast/banner instead of silently dropping it.
 *
 * When multiple issues target the same path, the first one wins (zod emits
 * the most specific issue first for a given location).
 */
export function deriveServerFieldErrors({
  issues,
  schema,
}: {
  issues: ServerValidationData["issues"];
  schema: JsonSchema;
}): { mapped: FieldErrorMap; unmapped: string[] } {
  const mapped: FieldErrorMap = {};
  const unmapped: string[] = [];
  const properties = schema.properties ?? {};

  for (const issue of issues) {
    const root = issue.path[0];
    const rootKey = typeof root === "string" ? root : undefined;

    if (rootKey === undefined || !(rootKey in properties)) {
      unmapped.push(issue.message);
      continue;
    }

    const fieldPath = issue.path.map(String).join(".");

    if (mapped[fieldPath] === undefined) {
      mapped[fieldPath] = issue.message;
    }
  }

  return { mapped, unmapped };
}

/**
 * Compute client-side validation problems from the JSON schema and the
 * current form values. Mirrors the validity computation DynamicForm already
 * does for `onValidChange`, but returns a per-field message map instead of a
 * single boolean so the offending fields can be flagged inline. The form is
 * considered valid exactly when this map is empty, so the same call drives
 * both the inline errors and the `onValidChange` boolean.
 *
 * At minimum this flags empty REQUIRED fields (reusing {@link isValueEmpty}
 * so the notion of "empty" stays in lock-step). Hidden and
 * conditionally-hidden required fields are skipped because the user cannot
 * fill them. Optional empty fields never produce an error.
 *
 * `keepExistingSecretFields` lists `x-secret` field keys whose value is
 * already stored server-side (edit mode). A blank input on such a field
 * means "keep the existing secret" - the redacted preview never returns the
 * value, so an empty input is expected and MUST count as valid rather than a
 * missing-required error. A blank `x-secret` field NOT in this set (create
 * mode, or a secret that was never set) is still treated as missing-required.
 */
export function deriveClientFieldErrors({
  schema,
  value,
  keepExistingSecretFields = [],
}: {
  schema: JsonSchema;
  value: Record<string, unknown>;
  keepExistingSecretFields?: string[];
}): FieldErrorMap {
  const errors: FieldErrorMap = {};
  const properties = schema.properties;
  if (!properties) return errors;

  const keepExisting = new Set(keepExistingSecretFields);
  const requiredKeys = schema.required ?? [];

  for (const key of requiredKeys) {
    const propSchema: JsonSchemaProperty | undefined = properties[key];
    if (!propSchema) continue;

    // Hidden fields are auto-populated; the user cannot act on them.
    if (propSchema["x-hidden"]) continue;

    const hiddenWhen = propSchema["x-hidden-when"];
    if (hiddenWhen && isFieldHiddenByCondition(hiddenWhen, value)) continue;

    if (!isValueEmpty(value[key], propSchema)) continue;

    // A blank secret that already has a stored value is "keep existing",
    // not missing-required.
    if (propSchema["x-secret"] === true && keepExisting.has(key)) continue;

    errors[key] = `${labelForKey(key)} is required.`;
  }

  return errors;
}

/**
 * Strip blank `x-secret` fields that are flagged keep-existing from a config
 * object before submit, so an empty input does not overwrite (clear) the
 * stored secret. The update path treats an absent secret key as "leave the
 * stored value untouched"; sending `""` would clear it. CREATE mode passes an
 * empty `keepExistingSecretFields`, so nothing is stripped there.
 */
export function omitKeepExistingSecrets({
  schema,
  value,
  keepExistingSecretFields,
}: {
  schema: JsonSchema;
  value: Record<string, unknown>;
  keepExistingSecretFields: string[];
}): Record<string, unknown> {
  const properties = schema.properties;
  if (!properties || keepExistingSecretFields.length === 0) return value;

  const keepExisting = new Set(keepExistingSecretFields);
  const result: Record<string, unknown> = {};

  for (const [key, fieldValue] of Object.entries(value)) {
    const propSchema = properties[key];
    const isBlankKeepExistingSecret =
      propSchema?.["x-secret"] === true &&
      keepExisting.has(key) &&
      isValueEmpty(fieldValue, propSchema);
    if (isBlankKeepExistingSecret) continue;
    result[key] = fieldValue;
  }

  return result;
}

/**
 * List the top-level `x-secret` field keys declared in a schema. The owning
 * page uses this in EDIT mode to mark every secret field as keep-existing
 * (their stored values are redacted out of the loaded preview, so a blank
 * input must mean "keep existing" rather than "clear"). CREATE mode passes
 * an empty list so blank secrets stay genuinely required.
 */
export function listSecretFieldKeys(schema: JsonSchema): string[] {
  const properties = schema.properties;
  if (!properties) return [];
  return Object.entries(properties)
    .filter(([, propSchema]) => propSchema["x-secret"] === true)
    .map(([key]) => key);
}

/**
 * Derive the human-readable label DynamicForm renders for a field key
 * (capitalized first letter), kept in sync with the label logic in
 * `DynamicForm.tsx` so inline messages read naturally.
 */
function labelForKey(key: string): string {
  return key.charAt(0).toUpperCase() + key.slice(1);
}
