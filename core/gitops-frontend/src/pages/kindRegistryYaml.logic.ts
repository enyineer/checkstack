/**
 * Pure, DOM-free YAML rendering logic for the GitOps Kind Registry page.
 *
 * The registry page documents each registered kind by rendering its JSON
 * schema as an annotated YAML skeleton (`generateSchemaYaml`) and a copyable
 * example manifest (`generateYamlExample`). All of that derivation is pure
 * string work over the schema shape, so it lives here away from the React
 * component (which imports `@checkstack/ui`) to keep it testable in isolation.
 */

/** A minimal view of the JSON-schema shape the registry consumes. */
export interface JsonSchemaProperty {
  type?: string;
  properties?: Record<string, JsonSchemaProperty>;
  items?: JsonSchemaProperty;
  required?: string[];
  description?: string;
  enum?: string[];
  anyOf?: JsonSchemaProperty[];
  default?: unknown;
}

/** A registered kind's documentation payload, as served by the GitOps API. */
export interface KindDescription {
  apiVersion: string;
  kind: string;
  metadataSchema: JsonSchemaProperty;
  specSchema: JsonSchemaProperty;
  extensions: Array<{
    namespace: string;
    specSchema: JsonSchemaProperty;
  }>;
  specSchemaDocumentation?: Array<{
    fieldPath: string;
    variantId?: string;
    label: string;
    description?: string;
    specSchema: JsonSchemaProperty;
    conditions?: Array<{
      fieldPath: string;
      variantIds: string[];
    }>;
  }>;
}

/**
 * Renders a schema's top-level properties as an annotated YAML skeleton.
 * For an object schema each property is emitted; for any other schema a single
 * `value:` line is emitted. Returns a placeholder comment when nothing renders.
 */
export function generateSchemaYaml(schema: JsonSchemaProperty): string {
  const lines: string[] = [];

  if (schema.type === "object" && schema.properties) {
    const required = new Set(schema.required);
    for (const [key, prop] of Object.entries(schema.properties)) {
      emitProperty({
        lines,
        key,
        prop,
        indent: 0,
        required: required.has(key),
      });
    }
  } else {
    emitProperty({
      lines,
      key: "value",
      prop: schema,
      indent: 0,
      required: true,
    });
  }

  if (lines.length === 0) {
    return "# No properties defined";
  }

  return lines.join("\n");
}

/**
 * Renders a full example manifest for a kind: `apiVersion`, `kind`, `metadata`,
 * and `spec` (base spec properties plus each extension namespace). When the
 * kind has neither base spec props nor extensions, an empty `spec: {}` is
 * emitted. `selections` swaps in a documented variant's schema for fields that
 * have a chosen variant.
 */
export function generateYamlExample({
  kind,
  selections,
}: {
  kind: KindDescription;
  selections?: Record<string, string>;
}): string {
  const lines = [`apiVersion: ${kind.apiVersion}`, `kind: ${kind.kind}`];

  if (kind.metadataSchema) {
    lines.push("metadata:");
    const metadataProps = kind.metadataSchema.properties ?? {};
    const metadataRequired = new Set(kind.metadataSchema.required);

    for (const [key, prop] of Object.entries(metadataProps)) {
      // Provide a nice default for name instead of generic "..."
      const customProp =
        key === "name"
          ? { ...prop, default: `my-${kind.kind.toLowerCase()}` }
          : prop;

      emitProperty({
        lines,
        key,
        prop: customProp,
        indent: 2,
        required: metadataRequired.has(key),
      });
    }
  } else {
    lines.push("metadata:", `  name: my-${kind.kind.toLowerCase()}`);
  }

  const baseProps = kind.specSchema.properties ?? {};
  const hasBaseProps = Object.keys(baseProps).length > 0;
  const hasExtensions = kind.extensions.length > 0;

  if (!hasBaseProps && !hasExtensions) {
    lines.push("spec: {}");
    return lines.join("\n");
  }

  lines.push("spec:");

  const baseRequired = new Set(kind.specSchema.required);
  for (const [key, prop] of Object.entries(baseProps)) {
    emitProperty({
      lines,
      key,
      prop,
      indent: 2,
      required: baseRequired.has(key),
      path: key,
      kind,
      selections,
    });
  }

  for (const ext of kind.extensions) {
    emitProperty({
      lines,
      key: ext.namespace,
      prop: ext.specSchema,
      indent: 2,
      required: false,
    });
  }

  return lines.join("\n");
}

/**
 * Recursively emits a YAML property with proper indentation.
 * Annotates optional and nullable fields with inline comments.
 */
export function emitProperty({
  lines,
  key,
  prop,
  indent,
  required,
  path,
  kind,
  selections,
}: {
  lines: string[];
  key: string;
  prop: JsonSchemaProperty;
  indent: number;
  required: boolean;
  path?: string;
  kind?: KindDescription;
  selections?: Record<string, string>;
}) {
  const pad = " ".repeat(indent);

  let effectiveProp = prop;
  if (path && kind?.specSchemaDocumentation && selections && selections[path]) {
    const variantId = selections[path];
    const doc = kind.specSchemaDocumentation.find(
      (d) => d.fieldPath === path && (d.variantId || d.label) === variantId,
    );
    if (doc) {
      effectiveProp = doc.specSchema;
    }
  }

  const annotation = buildAnnotation({ prop: effectiveProp, required });
  const effective = resolveEffective({ prop: effectiveProp });

  if (effective.type === "object" && effective.properties) {
    lines.push(`${pad}${key}:${annotation}`);
    const objRequired = new Set(effective.required);
    for (const [k, p] of Object.entries(effective.properties)) {
      emitProperty({
        lines,
        key: k,
        prop: p,
        indent: indent + 2,
        required: objRequired.has(k),
        path: path ? `${path}.${k}` : undefined,
        kind,
        selections,
      });
    }
  } else if (effective.type === "array") {
    lines.push(`${pad}${key}:${annotation}`);
    if (effective.items) {
      emitArrayItem({
        lines,
        itemSchema: effective.items,
        indent: indent + 2,
        path: path ? `${path}[]` : undefined,
        kind,
        selections,
      });
    } else {
      lines.push(`${pad}  - # ...`);
    }
  } else {
    let val = scalarExample({ prop: effective });

    if (key === "strategy" && path === "strategy" && selections?.["config"]) {
      val = `"${selections["config"]}"`;
    }
    if (
      key === "collectorId" &&
      path === "collectors[].collectorId" &&
      selections?.["collectors[].config"]
    ) {
      val = `"${selections["collectors[].config"]}"`;
    }

    lines.push(`${pad}${key}: ${val}${annotation}`);
  }
}

/**
 * Emits a single array item (the `- ` prefix) with proper handling of
 * objects, nested arrays, and scalar values.
 */
export function emitArrayItem({
  lines,
  itemSchema,
  indent,
  path,
  kind,
  selections,
}: {
  lines: string[];
  itemSchema: JsonSchemaProperty;
  indent: number;
  path?: string;
  kind?: KindDescription;
  selections?: Record<string, string>;
}) {
  const pad = " ".repeat(indent);
  const effective = resolveEffective({ prop: itemSchema });

  if (effective.type === "object" && effective.properties) {
    const itemRequired = new Set(effective.required);
    const entries = Object.entries(effective.properties);
    for (const [i, [k, p]] of entries.entries()) {
      const prefix = i === 0 ? `${pad}- ` : `${pad}  `;

      const nextPath = path
        ? path.endsWith("[]")
          ? `${path}.${k}`
          : `${path}[].${k}`
        : undefined;

      let currentProp = p;
      if (
        nextPath &&
        kind?.specSchemaDocumentation &&
        selections &&
        selections[nextPath]
      ) {
        const variantId = selections[nextPath];
        const doc = kind.specSchemaDocumentation.find(
          (d) =>
            d.fieldPath === nextPath && (d.variantId || d.label) === variantId,
        );
        if (doc) {
          currentProp = doc.specSchema;
        }
      }

      const itemAnnotation = buildAnnotation({
        prop: currentProp,
        required: itemRequired.has(k),
      });
      const inner = resolveEffective({ prop: currentProp });

      if (inner.type === "object" && inner.properties) {
        // Recurse into nested objects
        lines.push(`${prefix}${k}:${itemAnnotation}`);
        const nestedRequired = new Set(inner.required);
        for (const [nk, np] of Object.entries(inner.properties)) {
          emitProperty({
            lines,
            key: nk,
            prop: np,
            indent: indent + 4,
            required: nestedRequired.has(nk),
            path: nextPath ? `${nextPath}.${nk}` : undefined,
            kind,
            selections,
          });
        }
      } else if (inner.type === "array") {
        lines.push(`${prefix}${k}:${itemAnnotation}`);
        if (inner.items) {
          emitArrayItem({
            lines,
            itemSchema: inner.items,
            indent: indent + 4,
            path: nextPath ? `${nextPath}[]` : undefined,
            kind,
            selections,
          });
        } else {
          lines.push(`${" ".repeat(indent + 4)}- # ...`);
        }
      } else {
        let val = scalarExample({ prop: currentProp });
        if (
          k === "collectorId" &&
          nextPath === "collectors[].collectorId" &&
          selections?.["collectors[].config"]
        ) {
          val = `"${selections["collectors[].config"]}"`;
        }
        lines.push(`${prefix}${k}: ${val}${itemAnnotation}`);
      }
    }
  } else {
    lines.push(`${pad}- ${scalarExample({ prop: itemSchema })}`);
  }
}

/**
 * Builds an inline YAML comment annotation for optional/nullable fields.
 */
export function buildAnnotation({
  prop,
  required,
}: {
  prop: JsonSchemaProperty;
  required: boolean;
}): string {
  const tags: string[] = [];
  if (!required) tags.push("optional");
  if (isNullable({ prop })) tags.push("nullable");
  return tags.length > 0 ? ` # ${tags.join(", ")}` : "";
}

/**
 * Checks if a property allows null values (via anyOf with null type).
 */
export function isNullable({ prop }: { prop: JsonSchemaProperty }): boolean {
  if (prop.anyOf) {
    return prop.anyOf.some((s) => s.type === "null");
  }
  return false;
}

/**
 * Resolves the effective schema by unwrapping nullable anyOf wrappers.
 */
export function resolveEffective({
  prop,
}: {
  prop: JsonSchemaProperty;
}): JsonSchemaProperty {
  if (prop.anyOf) {
    const nonNull = prop.anyOf.filter((s) => s.type !== "null");
    if (nonNull.length === 1) return nonNull[0];
  }
  return prop;
}

/**
 * Returns a scalar YAML example value for a property.
 * Objects without defined properties (z.record) get a comment annotation.
 */
export function scalarExample({ prop }: { prop: JsonSchemaProperty }): string {
  const effective = resolveEffective({ prop });
  if (effective.enum) return effective.enum.map((e) => `"${e}"`).join(" | ");
  if (effective.default !== undefined) return JSON.stringify(effective.default);
  switch (effective.type) {
    case "string": {
      return '"..."';
    }
    case "number":
    case "integer": {
      return "0";
    }
    case "boolean": {
      return "false";
    }
    case "array": {
      return "[]";
    }
    case "object": {
      // Object without properties = z.record() or z.unknown() — annotate
      return "{} # key-value pairs";
    }
    default: {
      return '"..."';
    }
  }
}
