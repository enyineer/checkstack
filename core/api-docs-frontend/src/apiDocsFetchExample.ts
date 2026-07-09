/**
 * Pure (React-free) helpers backing the API docs "Fetch Example" generator.
 *
 * These live in their own module so they can be unit-tested without pulling in
 * React. `ApiDocsPage.tsx` imports the interfaces and `generateFetchExample`
 * from here.
 */

export interface OpenApiSpec {
  info: {
    title: string;
    version: string;
    description?: string;
  };
  paths: Record<string, Record<string, OperationObject>>;
  servers?: { url?: string }[];
  components?: {
    schemas?: Record<string, SchemaObject>;
  };
}

export interface ParameterObject {
  name: string;
  in: "query" | "path" | "header" | "cookie";
  required?: boolean;
  description?: string;
  schema?: SchemaObject;
}

export interface OperationObject {
  summary?: string;
  description?: string;
  operationId?: string;
  tags?: string[];
  parameters?: ParameterObject[];
  requestBody?: {
    content?: {
      "application/json"?: {
        schema?: SchemaObject;
      };
    };
  };
  responses?: Record<
    string,
    {
      description?: string;
      content?: Record<string, { schema?: SchemaObject }>;
    }
  >;
  "x-orpc-meta"?: {
    userType?: string;
    accessRules?: string[];
  };
}

export interface SchemaObject {
  type?: string | string[];
  properties?: Record<string, SchemaObject>;
  items?: SchemaObject;
  required?: string[];
  description?: string;
  enum?: (string | number | boolean | null)[];
  format?: string;
  nullable?: boolean;
  $ref?: string;
  additionalProperties?: SchemaObject | boolean;
  oneOf?: SchemaObject[];
  anyOf?: SchemaObject[];
  allOf?: SchemaObject[];
  example?: unknown;
  default?: unknown;
}

/** A JSON-serializable value used to model a generated example body. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

const MAX_EXAMPLE_DEPTH = 8;

/** Coerce an unknown (schema `example`/`default`/`enum` entry) to a JsonValue. */
function toJsonValue(value: unknown): JsonValue {
  if (value === null) return null;
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => toJsonValue(item));
  }
  if (typeof value === "object") {
    const out: { [key: string]: JsonValue } = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = toJsonValue(entry);
    }
    return out;
  }
  // functions / symbols / undefined have no JSON representation.
  return null;
}

/** Merge the object variants of an `allOf` into a single synthetic schema. */
function mergeAllOf({ variants }: { variants: SchemaObject[] }): SchemaObject {
  const merged: SchemaObject = { type: "object", properties: {}, required: [] };
  for (const variant of variants) {
    if (variant.properties) {
      merged.properties = { ...merged.properties, ...variant.properties };
    }
    if (variant.required) {
      merged.required = [...(merged.required ?? []), ...variant.required];
    }
  }
  return merged;
}

/**
 * Build a realistic example JSON value from an OpenAPI schema.
 *
 * Resolution order for a concrete value is `example` -> `default` -> `enum[0]`,
 * then a typed placeholder. `$ref`s are resolved against
 * `spec.components.schemas` with a cycle guard; a cycle or an unresolvable ref
 * yields `null`. A `maxDepth` guard bounds recursion.
 */
export function schemaToExampleValue({
  schema,
  spec,
  refStack = [],
  depth = 0,
}: {
  schema?: SchemaObject;
  spec: OpenApiSpec;
  refStack?: string[];
  depth?: number;
}): JsonValue {
  if (!schema) return null;
  if (depth > MAX_EXAMPLE_DEPTH) return null;

  // Explicit example / default / enum win over any inferred placeholder.
  if (schema.example !== undefined) return toJsonValue(schema.example);
  if (schema.default !== undefined) return toJsonValue(schema.default);
  if (schema.enum && schema.enum.length > 0) {
    return toJsonValue(schema.enum[0]);
  }

  // Resolve $ref against the components registry, guarding against cycles.
  if (schema.$ref) {
    if (refStack.includes(schema.$ref)) return null;
    const refName = schema.$ref.split("/").pop() ?? schema.$ref;
    const resolved = spec.components?.schemas?.[refName];
    if (!resolved) return null;
    return schemaToExampleValue({
      schema: resolved,
      spec,
      refStack: [...refStack, schema.$ref],
      depth,
    });
  }

  // oneOf / anyOf: pick the first variant.
  const variants = schema.oneOf ?? schema.anyOf;
  if (variants && variants.length > 0) {
    return schemaToExampleValue({
      schema: variants[0],
      spec,
      refStack,
      depth,
    });
  }

  // allOf: merge object variants, then emit.
  if (schema.allOf && schema.allOf.length > 0) {
    return schemaToExampleValue({
      schema: mergeAllOf({ variants: schema.allOf }),
      spec,
      refStack,
      depth,
    });
  }

  // Object: include every declared property (a realistic example).
  if (schema.type === "object" || schema.properties) {
    const out: { [key: string]: JsonValue } = {};
    for (const [key, value] of Object.entries(schema.properties ?? {})) {
      out[key] = schemaToExampleValue({
        schema: value,
        spec,
        refStack,
        depth: depth + 1,
      });
    }
    return out;
  }

  // Array: a single element derived from `items`.
  if (schema.type === "array") {
    if (!schema.items) return [];
    return [
      schemaToExampleValue({
        schema: schema.items,
        spec,
        refStack,
        depth: depth + 1,
      }),
    ];
  }

  // Nullable union such as ["string", "null"]: use the first non-null type.
  const primitiveType = Array.isArray(schema.type)
    ? (schema.type.find((t) => t !== "null") ?? schema.type[0])
    : schema.type;

  switch (primitiveType) {
    case "string": {
      return "string";
    }
    case "number":
    case "integer": {
      return 0;
    }
    case "boolean": {
      return true;
    }
    case "null": {
      return null;
    }
    default: {
      return null;
    }
  }
}

/**
 * Pick a query-param example value from a param's schema, preferring
 * `example` -> `default` -> `enum[0]`. Returns `undefined` when the schema
 * supplies nothing, so the caller can fall back to a placeholder.
 */
function queryParamExample({
  schema,
}: {
  schema?: SchemaObject;
}): string | undefined {
  if (!schema) return undefined;
  // First defined among example, default, enum[0] (order matters).
  const candidate = [schema.example, schema.default, schema.enum?.[0]].find(
    (value) => value !== undefined,
  );
  if (candidate === undefined || candidate === null) return undefined;
  if (
    typeof candidate === "string" ||
    typeof candidate === "number" ||
    typeof candidate === "boolean"
  ) {
    return String(candidate);
  }
  return undefined;
}

/**
 * Indent every line except the first by `indent` spaces. The first line stays
 * flush so it can sit directly after `JSON.stringify(`, while continuation
 * lines align under the `body:` key.
 */
function indentBlock({
  text,
  indent,
}: {
  text: string;
  indent: number;
}): string {
  const pad = " ".repeat(indent);
  return text
    .split("\n")
    .map((line, i) => (i === 0 || line.length === 0 ? line : pad + line))
    .join("\n");
}

/**
 * Generate a runnable `fetch(...)` example for an endpoint.
 *
 * - The base URL comes from `spec.servers[0].url` (trailing slash stripped);
 *   when absent the URL is relative (just `path` + query string).
 * - Query params substitute a schema-provided example (`example` -> `default`
 *   -> `enum[0]`, URL-encoded); otherwise a `<required|optional>` placeholder.
 * - Non-GET bodies render a realistic example object built from the request
 *   body schema.
 */
export function generateFetchExample({
  path,
  method,
  operation,
  spec,
}: {
  path: string;
  method: string;
  operation: OperationObject;
  spec: OpenApiSpec;
}): string {
  const baseUrl = (spec.servers?.[0]?.url ?? "").replace(/\/+$/, "");
  const upperMethod = method.toUpperCase();
  const bodySchema = operation.requestBody?.content?.["application/json"]?.schema;
  const hasBody = Boolean(bodySchema);

  const queryParams =
    operation.parameters?.filter((p) => p.in === "query") ?? [];
  const queryString =
    queryParams.length > 0
      ? "?" +
        queryParams
          .map((p) => {
            const example = queryParamExample({ schema: p.schema });
            const value =
              example === undefined
                ? `<${p.required ? "required" : "optional"}>`
                : encodeURIComponent(example);
            return `${p.name}=${value}`;
          })
          .join("&")
      : "";

  const includeContentType = hasBody;
  let example = `const response = await fetch("${baseUrl}${path}${queryString}", {
  method: "${upperMethod}",
  headers: {
${includeContentType ? '    "Content-Type": "application/json",\n' : ""}    "Authorization": "Bearer ck_<application-id>_<secret>"
  }`;

  if (hasBody) {
    const value = schemaToExampleValue({ schema: bodySchema, spec });
    const serialized = JSON.stringify(value, null, 2);
    const indented = indentBlock({ text: serialized, indent: 2 });
    example += `,
  body: JSON.stringify(${indented})`;
  }

  example += `
});

const data = await response.json();`;

  return example;
}
