import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

/**
 * Relocate a plugin's objects that were left in `public` by pre-isolation
 * deploys into the plugin's dedicated schema.
 *
 * ## Why this exists
 *
 * Each plugin's objects are supposed to live in a dedicated schema
 * (`plugin_<id>`). Deploys that predate schema isolation - or that ran
 * migrations before the connection/search_path handling was correct - created
 * the plugin's tables and enums in `public` instead, while the
 * `__drizzle_migrations` ledger lived in the plugin schema. Runtime kept
 * working only because the scoped-db search_path fell back to `public`.
 *
 * Rather than carry a permanent `public` fallback in the migration search_path
 * (which risks new objects silently landing in `public`), the loader moves the
 * stragglers into the plugin schema once, up front, with fully-qualified
 * `ALTER ... SET SCHEMA` statements. After this runs, every object the plugin
 * owns lives in `plugin_<id>`, so migrations can use a strict
 * `search_path = "plugin_<id>"` and new objects always land in the right place.
 *
 * The move is by-OID, so columns, foreign keys, enum references, indexes, and
 * owned sequences all keep working. It is idempotent: an object is moved only
 * if it currently exists in `public` and does not already exist in the plugin
 * schema, so fresh installs and already-migrated installs are no-ops.
 *
 * ## Which objects
 *
 * The owned-object set is the UNION of every Drizzle snapshot under the
 * plugin's `drizzle/meta/`, not just the latest. A table that an early
 * migration created and a later one drops (e.g. a since-removed table) still
 * exists in `public` on an upgrading database when its `DROP` migration is
 * pending; including it here means it gets moved into the plugin schema first,
 * so the unqualified `DROP TABLE` resolves under the strict search_path.
 */

/** Minimal pooled-client surface this helper needs (modelled on `pg.PoolClient`). */
export interface RelocationClient {
  query<T = Record<string, unknown>>(
    queryText: string,
    values?: unknown[],
  ): Promise<{ rows: T[] }>;
}

export interface PluginOwnedObjects {
  /** Tables, views, and materialized views (everything in `pg_class`-land). */
  relations: string[];
  /** Enum / composite type names. */
  types: string[];
}

// Snapshots carry far more than we read; accept and ignore the rest.
const objectEntrySchema = z
  .object({ name: z.string(), schema: z.string().optional() })
  .passthrough();
const snapshotSchema = z
  .object({
    tables: z.record(z.string(), objectEntrySchema).optional(),
    enums: z.record(z.string(), objectEntrySchema).optional(),
    sequences: z.record(z.string(), objectEntrySchema).optional(),
    views: z.record(z.string(), objectEntrySchema).optional(),
  })
  .passthrough();

/** An object belongs in the default/`public` namespace (i.e. is relocatable). */
function isDefaultSchema(schema: string | undefined): boolean {
  return schema === undefined || schema === "" || schema === "public";
}

/**
 * Read the union of all object names a plugin has ever declared, across every
 * snapshot in its `drizzle/meta/` folder.
 */
export function readPluginOwnedObjects(
  migrationsFolder: string,
): PluginOwnedObjects {
  const metaDir = path.join(migrationsFolder, "meta");
  if (!fs.existsSync(metaDir)) {
    return { relations: [], types: [] };
  }

  const relations = new Set<string>();
  const types = new Set<string>();

  const snapshotFiles = fs
    .readdirSync(metaDir)
    .filter((f) => f.endsWith("_snapshot.json"));

  for (const file of snapshotFiles) {
    const raw = JSON.parse(fs.readFileSync(path.join(metaDir, file), "utf8"));
    const snapshot = snapshotSchema.parse(raw);

    for (const entry of Object.values(snapshot.tables ?? {})) {
      if (isDefaultSchema(entry.schema)) relations.add(entry.name);
    }
    for (const entry of Object.values(snapshot.views ?? {})) {
      if (isDefaultSchema(entry.schema)) relations.add(entry.name);
    }
    for (const entry of Object.values(snapshot.sequences ?? {})) {
      if (isDefaultSchema(entry.schema)) relations.add(entry.name);
    }
    for (const entry of Object.values(snapshot.enums ?? {})) {
      if (isDefaultSchema(entry.schema)) types.add(entry.name);
    }
  }

  return { relations: [...relations], types: [...types] };
}

/** Double-quote and escape a Postgres identifier for safe interpolation. */
function quoteIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

/**
 * Map a `pg_class.relkind` to the right `ALTER ... SET SCHEMA` keyword. Kinds
 * not in this map (indexes, toast tables, composite-type rows, etc.) are never
 * relocated here.
 */
const ALTER_KEYWORD_BY_RELKIND: Record<string, string> = {
  r: "TABLE", // ordinary table
  p: "TABLE", // partitioned table
  S: "SEQUENCE", // sequence
  v: "VIEW", // view
  m: "MATERIALIZED VIEW", // materialized view
};

/**
 * Move the plugin's `public`-resident objects into `schema`. Returns the list
 * of moved objects (for logging). No-op when `schema` is `public`.
 */
export async function relocateLegacyPublicObjects({
  client,
  schema,
  owned,
}: {
  client: RelocationClient;
  schema: string;
  owned: PluginOwnedObjects;
}): Promise<{ moved: string[] }> {
  const moved: string[] = [];
  if (schema === "public") return { moved };

  const target = quoteIdent(schema);

  // --- Relations (tables / views / matviews / standalone sequences) ---
  if (owned.relations.length > 0) {
    const inPublic = await client.query<{ relname: string; relkind: string }>(
      `SELECT c.relname, c.relkind
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = ANY($1::text[])`,
      [owned.relations],
    );
    const inTarget = await client.query<{ relname: string }>(
      `SELECT c.relname
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1 AND c.relname = ANY($2::text[])`,
      [schema, owned.relations],
    );
    const alreadyMoved = new Set(inTarget.rows.map((r) => r.relname));

    for (const { relname, relkind } of inPublic.rows) {
      if (alreadyMoved.has(relname)) continue;
      const keyword = ALTER_KEYWORD_BY_RELKIND[relkind];
      if (!keyword) continue;
      await client.query(
        `ALTER ${keyword} public.${quoteIdent(relname)} SET SCHEMA ${target}`,
      );
      moved.push(`${keyword.toLowerCase()} ${relname}`);
    }
  }

  // --- Types (enums / composite types) ---
  if (owned.types.length > 0) {
    const inPublic = await client.query<{ typname: string }>(
      `SELECT t.typname
         FROM pg_type t
         JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public' AND t.typname = ANY($1::text[])`,
      [owned.types],
    );
    const inTarget = await client.query<{ typname: string }>(
      `SELECT t.typname
         FROM pg_type t
         JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = $1 AND t.typname = ANY($2::text[])`,
      [schema, owned.types],
    );
    const alreadyMoved = new Set(inTarget.rows.map((r) => r.typname));

    for (const { typname } of inPublic.rows) {
      if (alreadyMoved.has(typname)) continue;
      await client.query(
        `ALTER TYPE public.${quoteIdent(typname)} SET SCHEMA ${target}`,
      );
      moved.push(`type ${typname}`);
    }
  }

  return { moved };
}
