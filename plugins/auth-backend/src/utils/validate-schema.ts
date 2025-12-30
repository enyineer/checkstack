import { z } from "zod";

/**
 * Validates that a Zod schema can be safely used with ConfigService.
 * Checks for required fields without defaults that would fail when no config exists.
 *
 * @param schema - The Zod schema to validate
 * @param strategyId - The strategy ID for error messages
 * @throws Error if the schema has required fields without defaults
 */
export function validateStrategySchema(
  schema: z.ZodTypeAny,
  strategyId: string
): void {
  // Try to parse an empty object to see if the schema has required fields
  const result = schema.safeParse({});

  if (!result.success) {
    const requiredFields = result.error.issues
      .filter((err) => {
        // Filter for invalid_type errors where undefined was received
        if (err.code !== "invalid_type") return false;

        // Use type assertion since TypeScript types don't expose 'received'
        // but it exists at runtime for invalid_type errors
        const received = (err as unknown as { received: unknown }).received;
        return received === undefined;
      })
      .map((err) => err.path.join("."));

    if (requiredFields.length > 0) {
      throw new Error(
        `Strategy "${strategyId}" has invalid configuration schema: ` +
          `The following required fields are missing defaults: ${requiredFields.join(
            ", "
          )}. ` +
          `All fields in a strategy schema must either be optional or have default values ` +
          `to ensure graceful initialization when no configuration exists in the database.`
      );
    }

    // If there are other validation errors besides missing required fields,
    // it might be okay (e.g., format validation), so we don't throw
  }
}
