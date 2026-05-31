/**
 * Declarable secondary-index DDL for the generic entity store.
 *
 * `EntityIndexSpec`s map onto the single `entity_state` table as Postgres
 * expression indexes over `state->>'field'` (reactive automation engine
 * §15.1). The DDL is generated here and executed at plugin init (after
 * migrations run), idempotently via `CREATE INDEX IF NOT EXISTS`.
 *
 * Index name: `entity_state_<kind>_<name>_idx`. `kind` + `name` are
 * sanitized to a safe identifier charset; the field paths are validated to
 * be real top-level state keys before this runs (see the handle), so the
 * only injection surface is the kind/name/field identifiers — all of which
 * are quoted as string literals or sanitized identifiers below.
 */
import type { EntityIndexSpec } from "./define-entity";

/** Postgres identifiers cap at 63 bytes; keep generated names within it. */
const MAX_IDENTIFIER_LENGTH = 63;

/** Reduce an arbitrary token to a safe `[a-z0-9_]` identifier fragment. */
export function sanitizeIdentifier(token: string): string {
  const cleaned = token.toLowerCase().replaceAll(/[^a-z0-9_]/g, "_");
  // Avoid a leading digit producing an invalid bare identifier.
  return /^[0-9]/.test(cleaned) ? `_${cleaned}` : cleaned;
}

/** A single-quoted SQL string literal (escapes embedded quotes). */
function sqlStringLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function indexName(args: { kind: string; name: string }): string {
  const raw = `entity_state_${sanitizeIdentifier(args.kind)}_${sanitizeIdentifier(
    args.name,
  )}_idx`;
  return raw.length > MAX_IDENTIFIER_LENGTH
    ? raw.slice(0, MAX_IDENTIFIER_LENGTH)
    : raw;
}

/**
 * Build one `CREATE INDEX IF NOT EXISTS` statement for an index spec.
 *
 * Single-field specs produce a plain `(state->>'field')` expression index;
 * multi-field specs produce a composite expression index over each
 * field's text extraction (kind is part of the WHERE-free index but the
 * generic table is shared across kinds, so the index is partial on
 * `kind = '<kind>'` to avoid cross-kind bloat).
 */
export function buildIndexDdl<TState>(args: {
  kind: string;
  spec: EntityIndexSpec<TState>;
}): string {
  const { kind, spec } = args;
  const name = indexName({ kind, name: spec.name });
  const exprs = spec.fields
    .map((field) => `(state->>${sqlStringLiteral(field)})`)
    .join(", ");
  return (
    `CREATE INDEX IF NOT EXISTS "${name}" ON "entity_state" (${exprs}) ` +
    `WHERE "kind" = ${sqlStringLiteral(kind)}`
  );
}

/** Build the DDL for every spec of a kind. */
export function buildAllIndexDdl<TState>(args: {
  kind: string;
  indexes: ReadonlyArray<EntityIndexSpec<TState>>;
}): string[] {
  return args.indexes.map((spec) => buildIndexDdl({ kind: args.kind, spec }));
}
