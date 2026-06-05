import { z } from "zod";
import { ORPCError } from "@orpc/server";

/**
 * Postgres SQLSTATE codes for the error classes a *client* can trigger with bad
 * input. These must surface as 4xx, not 500 - a malformed uuid, an out-of-range
 * integer, an over-long string, or a constraint violation is the caller's
 * mistake, not an internal server error.
 *
 * Without this mapping a `where id = $1` with `$1 = "not-a-uuid"` reaches the
 * driver and throws `22P02`, which oRPC reports as a 500 - making routine
 * fuzzing/probing look like the server is broken and burying genuine 500s.
 *
 * @see https://www.postgresql.org/docs/current/errcodes-appendix.html
 */
const PG_CLIENT_ERROR_CODES: Record<string, { code: "BAD_REQUEST" | "CONFLICT"; message: string }> = {
  // Class 22 — data exception (the caller sent a value the type can't hold).
  "22P02": {
    code: "BAD_REQUEST",
    message: "Invalid input: a value was malformed (e.g. not a valid id).",
  },
  "22003": {
    code: "BAD_REQUEST",
    message: "Invalid input: a numeric value is out of the allowed range.",
  },
  "22001": {
    code: "BAD_REQUEST",
    message: "Invalid input: a text value exceeds the allowed length.",
  },
  "22007": {
    code: "BAD_REQUEST",
    message: "Invalid input: a date/time value is malformed.",
  },
  // Class 23 — integrity-constraint violation.
  "23502": {
    code: "BAD_REQUEST",
    message: "Invalid input: a required value is missing.",
  },
  "23503": {
    code: "BAD_REQUEST",
    message: "Invalid input: a referenced record does not exist.",
  },
  "23505": {
    code: "CONFLICT",
    message: "That record already exists.",
  },
  "23514": {
    code: "BAD_REQUEST",
    message: "Invalid input: a value failed a validation constraint.",
  },
};

// A Postgres driver error carries a SQLSTATE string in `code`. Drizzle may
// rethrow it wrapped, exposing the original on `cause`, so we check both shapes
// (mirrors the catalog-backend `pg-errors` matcher).
const pgErrorSchema = z.object({ code: z.string() });
const wrappedPgErrorSchema = z.object({ cause: pgErrorSchema });

function extractSqlState(error: unknown): string | undefined {
  const direct = pgErrorSchema.safeParse(error);
  if (direct.success) return direct.data.code;
  const wrapped = wrappedPgErrorSchema.safeParse(error);
  if (wrapped.success) return wrapped.data.cause.code;
  return undefined;
}

/**
 * Maps a caught Postgres driver error to an `ORPCError` with the right 4xx
 * status when the SQLSTATE indicates a client-caused fault. Returns `undefined`
 * for anything else (genuine 500s, application errors), so callers fall through
 * to their existing error-logging + rethrow path.
 *
 * The original error is preserved as `cause` for diagnostics; the client-facing
 * message is deliberately generic so we never leak column/constraint names.
 */
export function mapPgErrorToHttp(error: unknown): ORPCError<string, unknown> | undefined {
  // An already-mapped oRPC error (e.g. a handler's own CONFLICT/NOT_FOUND) must
  // pass through untouched.
  if (error instanceof ORPCError) return undefined;
  const sqlState = extractSqlState(error);
  if (!sqlState) return undefined;
  const mapping = PG_CLIENT_ERROR_CODES[sqlState];
  if (!mapping) return undefined;
  return new ORPCError(mapping.code, { message: mapping.message, cause: error });
}
