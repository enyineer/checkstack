import { z } from "zod";

/**
 * WeakSet to track which schemas are secrets.
 * Using WeakSet avoids memory leaks and doesn't rely on fragile internal APIs.
 */
const secretSchemas = new WeakSet<z.ZodTypeAny>();

/**
 * Custom Zod type for secret fields.
 * Uses branded type for TypeScript + WeakSet for runtime detection.
 */
export const secret = () => {
  const schema = z.string().brand<"secret">();
  secretSchemas.add(schema);
  return schema;
};

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
 * @param defaultValue - Optional default hex color value (e.g., "#3b82f6")
 */
export function color(defaultValue?: string) {
  const schema = z
    .string()
    .regex(HEX_COLOR_REGEX, "Invalid hex color format. Use #RGB or #RRGGBB")
    .brand<"color">();
  colorSchemas.add(schema);

  if (defaultValue !== undefined) {
    // Cast the default value to the branded type
    return schema.default(defaultValue as string & z.$brand<"color">);
  }

  return schema;
}

export type Color = z.infer<ReturnType<typeof color>>;

/**
 * Runtime check for color-branded schemas.
 * Automatically unwraps ZodOptional, ZodDefault, ZodNullable to check the inner schema.
 */
export function isColorSchema(schema: z.ZodTypeAny): boolean {
  return colorSchemas.has(unwrapSchema(schema));
}
