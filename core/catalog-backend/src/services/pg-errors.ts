import { z } from "zod";

/** Postgres SQLSTATE for a unique-constraint violation. */
const UNIQUE_VIOLATION = "23505";

// A Postgres driver error carries a SQLSTATE string in `code`. Drizzle may
// rethrow it wrapped, exposing the original on `cause`, so we check both shapes.
const pgErrorSchema = z.object({ code: z.string() });
const wrappedPgErrorSchema = z.object({ cause: pgErrorSchema });

/**
 * True when `error` is (or wraps) a Postgres unique-constraint violation. Used
 * to turn a race-induced duplicate insert into a clean `CONFLICT` instead of a
 * 500, mirroring the pre-insert name check.
 */
export function isUniqueViolation(error: unknown): boolean {
  const direct = pgErrorSchema.safeParse(error);
  if (direct.success && direct.data.code === UNIQUE_VIOLATION) return true;
  const wrapped = wrappedPgErrorSchema.safeParse(error);
  return wrapped.success && wrapped.data.cause.code === UNIQUE_VIOLATION;
}
