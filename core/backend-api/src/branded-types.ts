import { z } from "zod";

/**
 * WeakSet to track which schemas are secrets.
 * Using WeakSet avoids memory leaks and doesn't rely on fragile internal APIs.
 */
const secretSchemas = new WeakSet<z.ZodTypeAny>();

/**
 * Options for custom branded types.
 */
export interface BrandedTypeOptions {
  /** Description for the field (shown in UI) */
  description?: string;
  /** Default value (makes the field optional with a default) */
  defaultValue?: string;
}

/**
 * Custom Zod type for secret fields.
 * Uses branded type for TypeScript + WeakSet for runtime detection.
 *
 * DO NOT chain .describe() or .default() after this function.
 * Pass options instead to ensure WeakSet tracking works correctly.
 *
 * @example
 * // Required secret with description:
 * botToken: secret({ description: "API Token" }),
 *
 * // Optional secret:
 * password: secret({ description: "Password" }).optional(),
 *
 * // Secret with default (not common for secrets):
 * key: secret({ description: "API Key", defaultValue: "default" }),
 */
export function secret(options?: BrandedTypeOptions) {
  const base = z.string().brand<"secret">();
  let schema: z.ZodTypeAny = options?.description
    ? base.describe(options.description)
    : base;

  // Track the final schema (after describe)
  secretSchemas.add(schema);

  // Apply default if provided
  if (options?.defaultValue !== undefined) {
    schema = (schema as z.ZodString).default(options.defaultValue);
  }

  return schema as z.ZodType<string & z.$brand<"secret">>;
}

export type Secret = z.infer<ReturnType<typeof secret>>;

/**
 * Unwraps a Zod schema to get the inner schema, handling:
 * - ZodOptional
 * - ZodDefault
 * - ZodNullable
 */
function unwrapSchema(schema: z.ZodTypeAny): z.ZodTypeAny {
  let unwrapped = schema;

  // Unwrap ZodOptional
  if (unwrapped instanceof z.ZodOptional) {
    unwrapped = unwrapped.unwrap() as z.ZodTypeAny;
  }

  // Unwrap ZodDefault
  if (unwrapped instanceof z.ZodDefault) {
    unwrapped = unwrapped.def.innerType as z.ZodTypeAny;
  }

  // Unwrap ZodNullable
  if (unwrapped instanceof z.ZodNullable) {
    unwrapped = unwrapped.unwrap() as z.ZodTypeAny;
  }

  return unwrapped;
}

/**
 * Runtime check for secret-branded schemas.
 * Automatically unwraps ZodOptional, ZodDefault, ZodNullable to check the inner schema.
 */
export function isSecretSchema(schema: z.ZodTypeAny): boolean {
  return secretSchemas.has(unwrapSchema(schema));
}

/**
 * WeakSet to track which schemas are colors.
 * Using WeakSet avoids memory leaks and doesn't rely on fragile internal APIs.
 */
const colorSchemas = new WeakSet<z.ZodTypeAny>();

/**
 * Hex color regex pattern.
 * Matches: #RGB or #RRGGBB (case insensitive)
 */
const HEX_COLOR_REGEX = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/;

/**
 * Custom Zod type for color fields (hex colors).
 * Uses branded type for TypeScript + WeakSet for runtime detection.
 * Validates that the value is a valid hex color (#RGB or #RRGGBB).
 *
 * DO NOT chain .describe() or .default() after this function.
 * Pass options instead to ensure WeakSet tracking works correctly.
 *
 * @example
 * // Required color with description:
 * primaryColor: color({ description: "Primary brand color" }),
 *
 * // Color with default value:
 * accentColor: color({ description: "Accent color", defaultValue: "#3b82f6" }),
 *
 * // Optional color:
 * backgroundColor: color({ description: "Background" }).optional(),
 */
export function color(options?: BrandedTypeOptions) {
  const base = z
    .string()
    .regex(HEX_COLOR_REGEX, "Invalid hex color format. Use #RGB or #RRGGBB")
    .brand<"color">();

  let schema: z.ZodTypeAny = options?.description
    ? base.describe(options.description)
    : base;

  // Track the final schema (after describe)
  colorSchemas.add(schema);

  // Apply default if provided
  if (options?.defaultValue !== undefined) {
    schema = (schema as z.ZodString).default(options.defaultValue);
  }

  return schema as z.ZodType<string & z.$brand<"color">>;
}

export type Color = z.infer<ReturnType<typeof color>>;

/**
 * Runtime check for color-branded schemas.
 * Automatically unwraps ZodOptional, ZodDefault, ZodNullable to check the inner schema.
 */
export function isColorSchema(schema: z.ZodTypeAny): boolean {
  return colorSchemas.has(unwrapSchema(schema));
}
