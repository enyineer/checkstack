import type { z } from "zod";

/**
 * Discriminator placed on the `ORPCError.data` payload so the frontend can
 * tell a connection-config validation failure apart from any other
 * structured error data and map each issue onto a form field.
 */
export const CONFIG_VALIDATION_ERROR_CODE = "CONFIG_VALIDATION";

/** A single field-scoped validation problem crossing the oRPC boundary. */
export interface ConfigValidationIssue {
  /** Field path (string/number segments only; symbols are dropped). */
  path: (string | number)[];
  message: string;
}

/** Structured payload attached to `ORPCError.data` for config validation. */
export interface ConfigValidationErrorData {
  code: typeof CONFIG_VALIDATION_ERROR_CODE;
  issues: ConfigValidationIssue[];
}

/**
 * Build the structured `data` payload for a connection-config validation
 * failure from a zod error. Symbol path segments cannot survive JSON
 * serialization and never name a form field, so they are filtered out. Kept
 * pure (no oRPC) so the wire shape can be unit-tested against the frontend
 * parser without standing up the router.
 */
export function buildConfigValidationErrorData(
  error: z.ZodError,
): ConfigValidationErrorData {
  return {
    code: CONFIG_VALIDATION_ERROR_CODE,
    issues: error.issues.map((issue) => ({
      path: issue.path.filter(
        (segment): segment is string | number =>
          typeof segment === "string" || typeof segment === "number",
      ),
      message: issue.message,
    })),
  };
}
