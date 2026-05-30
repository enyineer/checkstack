import { z } from "zod";

import type { EditorType } from "@checkstack/common";

// Re-export for local consumers
export type { EditorType } from "@checkstack/common";

/**
 * Metadata type for configuration schemas.
 * Provides autocompletion for `.meta()` calls on config fields.
 */
export interface ConfigMeta {
  /** Mark as a secret field (password input, encrypted storage, redacted in UI) */
  "x-secret"?: boolean;
  /** Mark as a color field (color picker input) */
  "x-color"?: boolean;
  /** Mark as hidden (auto-populated, not shown in forms) */
  "x-hidden"?: boolean;
  /** Name of the resolver function for dynamic options dropdown */
  "x-options-resolver"?: string;
  /** Field names this field depends on (triggers refetch when they change) */
  "x-depends-on"?: string[];
  /** If true, renders a searchable/filterable dropdown */
  "x-searchable"?: boolean;
  /**
   * Conditionally hide this field based on sibling field values.
   * Keys are sibling field names, values are arrays of values that trigger hiding.
   * The field is hidden when any condition matches.
   * @example { authMode: ["datacenter"] } — hides this field when authMode is "datacenter"
   */
  "x-hidden-when"?: Record<string, string[]>;
  /**
   * Available editor types for this field. Renders a dropdown to select editor mode.
   * When templateProperties are provided to DynamicForm, autocomplete works in all types.
   * - "none": Field is disabled/empty
   * - "raw": Multi-line textarea
   * - "json": CodeEditor with JSON syntax highlighting
   * - "formdata": Key/value pair editor (URL-encoded)
   */
  "x-editor-types"?: EditorType[];
  /**
   * Mark this field as an inline script that can be tested in-UI. When the
   * editor renders the field (via `MultiTypeEditorField`) and the owning
   * page supplies a `scriptTestRenderer`, a test panel appears beneath the
   * editor so operators can run the script against a sample context.
   */
  "x-script-testable"?: boolean;
}

/**
 * Registry for config schema metadata.
 * Used by schema-utils.ts and config-service.ts for field detection.
 */
export const configRegistry = z.registry<ConfigMeta>();

// ============================================================================
// SCHEMA UNWRAPPING - Handle Optional/Default/Nullable wrappers
// ============================================================================

/**
 * Unwraps a Zod schema to get the inner schema, handling:
 * - ZodOptional
 * - ZodDefault
 * - ZodNullable
 */
function unwrapSchema(schema: z.ZodTypeAny): z.ZodTypeAny {
  let unwrapped = schema;

  if (unwrapped instanceof z.ZodOptional) {
    unwrapped = unwrapped.unwrap() as z.ZodTypeAny;
  }

  if (unwrapped instanceof z.ZodDefault) {
    unwrapped = unwrapped.def.innerType as z.ZodTypeAny;
  }

  if (unwrapped instanceof z.ZodNullable) {
    unwrapped = unwrapped.unwrap() as z.ZodTypeAny;
  }

  return unwrapped;
}

/**
 * Get config metadata for a schema.
 * Automatically unwraps Optional/Default/Nullable wrappers.
 */
export function getConfigMeta(schema: z.ZodTypeAny): ConfigMeta | undefined {
  return configRegistry.get(unwrapSchema(schema));
}

/**
 * Check if a schema has secret metadata.
 */
export function isSecretSchema(schema: z.ZodTypeAny): boolean {
  return getConfigMeta(schema)?.["x-secret"] === true;
}

/**
 * Check if a schema has color metadata.
 */
export function isColorSchema(schema: z.ZodTypeAny): boolean {
  return getConfigMeta(schema)?.["x-color"] === true;
}

/**
 * Check if a schema has hidden metadata.
 */
export function isHiddenSchema(schema: z.ZodTypeAny): boolean {
  return getConfigMeta(schema)?.["x-hidden"] === true;
}

/**
 * Get options resolver metadata for a schema.
 */
export function getOptionsResolverMetadata(
  schema: z.ZodTypeAny,
):
  | { resolver: string; dependsOn?: string[]; searchable?: boolean }
  | undefined {
  const meta = getConfigMeta(schema);
  if (!meta?.["x-options-resolver"]) return undefined;
  return {
    resolver: meta["x-options-resolver"],
    dependsOn: meta["x-depends-on"],
    searchable: meta["x-searchable"],
  };
}

// ============================================================================
// TYPED ZOD CONFIG - Uses .register() directly instead of overriding .meta()
// ============================================================================

/**
 * Create a config string field with typed metadata.
 * Registers metadata in configRegistry for detection by schema-utils and config-service.
 *
 * @example
 * ```typescript
 * import { configString } from "@checkstack/backend-api";
 *
 * const schema = z.object({
 *   apiToken: configString({ "x-secret": true }).describe("API Token"),
 *   projectKey: configString({
 *     "x-options-resolver": "projectOptions",
 *     "x-depends-on": ["connectionId"],
 *   }),
 * });
 * ```
 */
export function configString(meta: ConfigMeta) {
  const schema = z.string();
  schema.register(configRegistry, meta);
  return schema;
}

/**
 * Create a config number field with typed metadata.
 */
export function configNumber(meta: ConfigMeta) {
  const schema = z.number();
  schema.register(configRegistry, meta);
  return schema;
}

/**
 * Create a config boolean field with typed metadata.
 */
export function configBoolean(meta: ConfigMeta) {
  const schema = z.boolean();
  schema.register(configRegistry, meta);
  return schema;
}
