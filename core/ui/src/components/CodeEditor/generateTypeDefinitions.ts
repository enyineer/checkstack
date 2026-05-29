import type { JsonSchemaProperty } from "../DynamicForm/types";

/**
 * Options for generating TypeScript type definitions from JSON Schema.
 */
export interface GenerateTypesOptions {
  /** For integration scripts - the event payload schema */
  eventPayloadSchema?: JsonSchemaProperty;

  /** For healthcheck scripts - the collector config schema */
  collectorConfigSchema?: JsonSchemaProperty;
}

/**
 * Generate TypeScript type definitions from JSON Schema.
 * These are injected into Monaco Editor for real IntelliSense.
 *
 * @example
 * ```typescript
 * const typeDefinitions = generateTypeDefinitions({
 *   eventPayloadSchema: eventSchema,
 * });
 * <CodeEditor typeDefinitions={typeDefinitions} language="typescript" />
 * ```
 */
export function generateTypeDefinitions(options: GenerateTypesOptions): string {
  const lines: string[] = [];

  // Integration script context (event-based)
  if (options.eventPayloadSchema) {
    const payloadType = jsonSchemaToTypeScript(options.eventPayloadSchema);

    lines.push(`
/** Expected return type for integration scripts */
interface IntegrationScriptResult {
  /** Optional external ID for tracking (e.g., ticket number, message ID) */
  id?: string;
  /** Optional external ID alias */
  externalId?: string;
}

/** Event being delivered to this integration script */
declare const context: {
  /** Event information */
  readonly event: {
    /** Fully qualified event ID (e.g., "incident.created") */
    readonly eventId: string;
    /** Event payload data */
    readonly payload: ${payloadType};
    /** ISO timestamp when the event occurred */
    readonly timestamp: string;
    /** Unique delivery ID for this delivery attempt */
    readonly deliveryId: string;
  };
  /** Subscription that triggered this delivery */
  readonly subscription: {
    /** Subscription ID */
    readonly id: string;
    /** Subscription name */
    readonly name: string;
  };
};
    `);
  }

  // Healthcheck script context (config-based, ESM module).
  // The runner spawns a Bun subprocess, sets \`globalThis.context\`, then
  // dynamically imports the user module. So scripts can \`import\` from the
  // Node standard library and \`export default\` their result.
  if (options.collectorConfigSchema) {
    const configType = jsonSchemaToTypeScript(options.collectorConfigSchema);

    lines.push(`
/** Expected return shape for inline-script health checks. */
interface HealthCheckScriptResult {
  /** Whether the health check passed. */
  success: boolean;
  /** Optional status message — surfaces in the run detail. */
  message?: string;
  /** Optional numeric value — feeds the value chart + anomaly detection. */
  value?: number;
}

/** Runtime context exposed as a global by the inline-script runner. */
declare const context: {
  /** Strongly-typed collector configuration. */
  readonly config: ${configType};
};
    `);
  }

  // We deliberately don't redeclare `console`, `fetch`, the Node stdlib, or
  // the Bun globals here: the editor mounts the bundled upstream `@types/node`
  // + `bun-types` declarations into the TypeScript service, so all of that is
  // already in scope.
  return lines.join("\n");
}

/**
 * Convert a JSON Schema to a TypeScript type string.
 * Handles objects, arrays, primitives, and enums.
 *
 * Exported for reuse by `scriptContext.ts`, which uses the same converter
 * to build typed `context.config` / `context.event.payload` blocks for
 * inline-script editors.
 */
export function jsonSchemaToTypeScript(
  schema: JsonSchemaProperty,
  indent: number = 0,
): string {
  const pad = "  ".repeat(indent);

  // Object type with properties
  if (schema.type === "object" && schema.properties) {
    const props = Object.entries(schema.properties)
      .map(([key, propSchema]) => {
        const optional = schema.required?.includes(key) ? "" : "?";
        const type = jsonSchemaToTypeScript(propSchema, indent + 1);
        const description = propSchema.description
          ? `/** ${propSchema.description} */\n${pad}  `
          : "";
        return `${description}readonly ${key}${optional}: ${type};`;
      })
      .map((line) =>
        line
          .split("\n")
          .map((l) => `${pad}  ${l}`)
          .join("\n"),
      )
      .join("\n");
    return `{\n${props}\n${pad}}`;
  }

  // Array type
  if (schema.type === "array" && schema.items) {
    const itemType = jsonSchemaToTypeScript(schema.items, indent);
    return `readonly ${itemType}[]`;
  }

  // Enum type
  if (schema.enum) {
    return schema.enum.map((v) => JSON.stringify(v)).join(" | ");
  }

  // Primitive types
  if (schema.type === "string") return "string";
  if (schema.type === "number" || schema.type === "integer") return "number";
  if (schema.type === "boolean") return "boolean";
  if (schema.type === "null") return "null";

  // Record/dictionary type
  if (schema.type === "object" && schema.additionalProperties) {
    const valueType =
      typeof schema.additionalProperties === "object"
        ? jsonSchemaToTypeScript(schema.additionalProperties, indent)
        : "unknown";
    return `Record<string, ${valueType}>`;
  }

  // Fallback
  return "unknown";
}
