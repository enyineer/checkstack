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
  /**
   * Stable, unique-within-schema identifier for a secret that is EXTRACTED into
   * the internal secret store (the config-secret extraction channel used by
   * health-check strategies/collectors and integration connections). The
   * internal secret is keyed by this id, NOT by the field's name/position, so
   * renaming or moving the field never strands the stored value.
   *
   * Set this via {@link configSecret} (which requires it) - NOT for the generic
   * `configString({ "x-secret": true })` secrets that ConfigService encrypts
   * in place or that resolve as `${{ secrets.NAME }}` references. See the
   * "secret handling" architecture doc for which mechanism to use.
   */
  "x-secret-id"?: string;
  /** Mark as a color field (color picker input) */
  "x-color"?: boolean;
  /** Mark as hidden (auto-populated, not shown in forms) */
  "x-hidden"?: boolean;
  /** Name of the resolver function for dynamic options dropdown */
  "x-options-resolver"?: string;
  /**
   * How resolved options render: a compact `select` (default) or a browsable
   * `catalog` modal that shows each option's description (use when a label
   * alone is not enough to choose, e.g. an AI skill picker).
   */
  "x-options-style"?: "select" | "catalog";
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
  /**
   * Mark a record field as a secret -> env mapping
   * (`{ ENV_NAME: "${{ secrets.NAME }}" }`). The editor renders a
   * dedicated key (env name) + secret-name picker, with the available
   * names supplied to `DynamicForm` via `secretNames` (from the secrets
   * plugin's `listSecretNames`). Without the marker the record falls back
   * to the plain JSON editor.
   */
  "x-secret-env"?: boolean;
  /**
   * Mark a string field as templatable. Its value is rendered through the
   * template engine (`{{ environment.* }}` / `{{ check.* }}` /
   * `{{ system.* }}`) at execute time, per resolved environment, BEFORE the
   * collector reads it. ONLY `x-templatable` fields are rendered; every other
   * field is passed through verbatim (so a literal `{{` in a non-templatable
   * field is never touched).
   *
   * A field MUST NOT carry both `x-secret` (or `x-secret-env`) and
   * `x-templatable` — secrets and templating are resolved in separate ordered
   * passes (secrets first) and must never combine. This is enforced at load
   * time via {@link assertNoSecretTemplatableConflict}.
   */
  "x-templatable"?: boolean;
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
 *
 * Loops so that multi-level wrappers (e.g. `.optional().default()`) are fully
 * peeled — a single-pass strip misses the inner wrapper and causes
 * `getConfigMeta` to return `undefined` for deeply-wrapped `x-templatable`
 * fields.
 */
function unwrapSchema(schema: z.ZodTypeAny): z.ZodTypeAny {
  let current = schema;
  for (;;) {
    if (current instanceof z.ZodOptional || current instanceof z.ZodNullable) {
      current = current.unwrap() as z.ZodTypeAny;
      continue;
    }
    if (current instanceof z.ZodDefault) {
      current = current.def.innerType as z.ZodTypeAny;
      continue;
    }
    return current;
  }
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
 * The stable extraction id of a secret field, or `undefined` when the field is
 * not an extraction-channel secret (a plain `configString({ "x-secret": true })`
 * has none). Declared via {@link configSecret}.
 */
export function getSecretId(schema: z.ZodTypeAny): string | undefined {
  return getConfigMeta(schema)?.["x-secret-id"];
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
 * Check if a schema is marked templatable (its string value is rendered
 * through the template engine before the collector reads it).
 */
export function isTemplatableSchema(schema: z.ZodTypeAny): boolean {
  return getConfigMeta(schema)?.["x-templatable"] === true;
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
 * Metadata for {@link configSecret}. Every field of {@link ConfigMeta} EXCEPT
 * `x-secret`/`x-secret-id` (set for you), plus a REQUIRED stable `id`.
 */
export type ConfigSecretMeta = Omit<ConfigMeta, "x-secret" | "x-secret-id"> & {
  /**
   * Stable id for this secret's extracted value, UNIQUE within the enclosing
   * config schema. Keep it stable across renames/moves - it is the internal
   * secret's key. Uniqueness is enforced at plugin registration.
   */
  id: string;
};

/**
 * Declare a secret string field that is EXTRACTED into the internal secret
 * store (the config-secret extraction channel: health-check strategy/collector
 * configs, integration connection configs). The extracted value is keyed by the
 * required stable `id`, so renaming or moving the field never strands it.
 *
 * Use this - NOT `configString({ "x-secret": true })` - whenever a plugin
 * accepts an INLINE secret that must be extracted, redacted on read, and
 * resolved (inline value or `${{ secrets.NAME }}` reference) at run time. For a
 * secret that ConfigService encrypts in place (singleton/admin config) keep
 * plain `configString({ "x-secret": true })`. The `id` is required at compile
 * time.
 *
 * @example
 * ```typescript
 * const schema = z.object({
 *   password: configSecret({ id: "password" }).describe("SSH password"),
 * });
 * ```
 */
export function configSecret(meta: ConfigSecretMeta) {
  const { id, ...rest } = meta;
  const schema = z.string();
  schema.register(configRegistry, {
    ...rest,
    "x-secret": true,
    "x-secret-id": id,
  });
  return schema;
}

/**
 * Assert every `x-secret` leaf in a config schema declares a NON-EMPTY,
 * UNIQUE-within-the-schema `x-secret-id` (i.e. uses {@link configSecret}). Call
 * at plugin registration so a misconfigured schema fails boot rather than
 * silently mis-keying (or orphaning) an extraction-channel secret at run time.
 * `label` names the schema in the error (e.g. the strategy/collector/provider
 * id). Sibling registration guard to {@link assertNoSecretTemplatableConflict}.
 */
export function validateSecretIds({
  schema,
  label,
}: {
  schema: z.ZodTypeAny;
  label: string;
}): void {
  // `seen` carries the ids declared on the path INTO the current node, so a
  // secret collides with a sibling/ancestor secret but NOT with one in a
  // parallel union branch (only one branch is ever populated at run time).
  //
  // `container` names an UNSUPPORTED enclosing composite (null = supported so
  // far). A config secret must sit at a fixed field of a plain object (any depth,
  // optionally inside a union); anything else is rejected at boot so it can never
  // reach - and be silently skipped by - the run-time extraction walk
  // (walkSecretFields). Two failure modes justify this:
  //   - array / record / tuple / map: the internal-secret key is
  //     keyParts(secretId) with NO element / dynamic-key index, so entries would
  //     collapse onto one stored value (and walkSecretFields never descends
  //     record/tuple/map at all).
  //   - intersection (z.intersection / .and()): neither this guard nor
  //     walkSecretFields descends it, so a secret inside would be persisted
  //     PLAINTEXT. (Use .extend() - which yields a plain ZodObject - instead.)
  // Rejecting a secret found under ANY of these keeps the boot guard and the
  // extraction walk in lock-step.
  const walk = (
    node: z.ZodTypeAny,
    seen: Set<string>,
    container: string | null,
  ): void => {
    const s = unwrapSchema(node);
    if (isSecretSchema(s)) {
      const id = getSecretId(s);
      if (!id) {
        throw new Error(
          `${label}: an x-secret field has no x-secret-id. Use configSecret({ id }).`,
        );
      }
      if (container) {
        throw new Error(
          `${label}: x-secret-id "${id}" is nested inside ${container}. ` +
            `Extraction-channel secrets must sit at a fixed field of a plain ` +
            `object (optionally inside a union): the internal-secret key cannot ` +
            `address array / record / tuple / map entries, and the extraction ` +
            `walk does not descend an intersection, so the secret would collide ` +
            `or be left plaintext at rest. Use z.object / .extend() and lift the ` +
            `secret to a fixed field, or model repeated entries as separate scopes.`,
        );
      }
      if (seen.has(id)) {
        throw new Error(
          `${label}: duplicate x-secret-id "${id}". Secret ids must be unique within a schema.`,
        );
      }
      seen.add(id);
      return;
    }
    if (s instanceof z.ZodObject) {
      for (const field of Object.values(
        s.shape as Record<string, z.ZodTypeAny>,
      )) {
        walk(field, seen, container);
      }
      return;
    }
    // Unsupported composites: descend so a secret nested inside is FOUND and
    // rejected (the `.def` accessors are Zod-internal; cast matches the
    // `.element` / `.options` / `.shape` casts used throughout this walk).
    if (s instanceof z.ZodArray) {
      walk(s.element as z.ZodTypeAny, seen, "an array");
      return;
    }
    if (s instanceof z.ZodTuple) {
      for (const item of s.def.items as z.ZodTypeAny[]) {
        walk(item, seen, "a tuple");
      }
      return;
    }
    if (s instanceof z.ZodRecord || s instanceof z.ZodMap) {
      walk(s.def.keyType as z.ZodTypeAny, seen, "a record / map");
      walk(s.def.valueType as z.ZodTypeAny, seen, "a record / map");
      return;
    }
    if (s instanceof z.ZodIntersection) {
      // Both sides contribute fields to the same merged value; walkSecretFields
      // does not descend either, so any secret here is unsupported.
      walk(s.def.left as z.ZodTypeAny, seen, "an intersection (z.intersection / .and())");
      walk(s.def.right as z.ZodTypeAny, seen, "an intersection (z.intersection / .and())");
      return;
    }
    if (s instanceof z.ZodDiscriminatedUnion || s instanceof z.ZodUnion) {
      // Fork per branch: each option sees the ancestor ids but is invisible to
      // its sibling branches, so two branches may reuse an id without clashing.
      for (const option of s.options as z.ZodTypeAny[]) {
        walk(option, new Set(seen), container);
      }
    }
  };
  walk(schema, new Set<string>(), null);
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

/**
 * Attach config metadata to an existing schema (e.g. a `z.record`) and
 * return it. Use this when a field's base schema is defined elsewhere
 * (such as `secretEnvMappingSchema` from `@checkstack/secrets-common`) but
 * still needs editor metadata like `x-secret-env`.
 */
export function withConfigMeta<T extends z.ZodTypeAny>(
  schema: T,
  meta: ConfigMeta,
): T {
  // The registry is typed `z.registry<ConfigMeta>()`, so registering the
  // meta is sound; the generic `T` confuses zod's conditional `.register`
  // overload, so register through the base schema type.
  (schema as z.ZodTypeAny).register(configRegistry, meta);
  return schema;
}
