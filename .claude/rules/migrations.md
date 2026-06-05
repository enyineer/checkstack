# Database migrations

Migrations are managed with **Drizzle** (`drizzle-kit`). Each backend package
owns its own `drizzle/` folder (`*.sql` files, `meta/_journal.json`, and
`meta/*_snapshot.json`) and a `generate` script.

## The one hard rule: migrations are append-only

**NEVER edit, delete, rename, or re-order an existing migration** - not the
`.sql` file, not its `meta/*_snapshot.json`, not its `meta/_journal.json` entry.
This holds **even for a migration you just added and even if it has not been
released yet.**

**Why:** the Drizzle migrator records each applied migration by hash in the
database. The moment a migration has run anywhere - your local dev DB, a
teammate's, CI, staging, prod - that database is pinned to that exact file. If
you change the file, the migrator sees a new/last-changed migration and either
(a) refuses / errors on the hash mismatch, or (b) tries to re-run it and
collides with objects the original already created (`relation ... already
exists`). A green typecheck/lint does **not** catch this; it only blows up at
startup against an existing database. Rewriting an already-applied migration is
the single most common way to wedge everyone's dev environment.

## How to change or fix the schema (always forward-only)

To change the schema - **including fixing or adjusting a migration you added
moments ago** - add a NEW migration:

1. Edit the `schema.ts` to the desired final state.
2. Run the package's generator so the new `.sql` **and** the snapshot/journal
   stay in sync - never hand-write the snapshot:

   ```bash
   bun run --filter '@checkstack/<pkg>-backend' generate
   ```

3. If the change needs data work (de-dupe before a `UNIQUE` index, backfill
   before a `NOT NULL`, a value transform), **hand-add the custom SQL to the
   newly generated file** - this is allowed and expected. Put the data
   statements before the constraint, separated by `--> statement-breakpoint`:

   ```sql
   -- resolve duplicates so the unique index can be created
   UPDATE "t" AS x SET "name" = x."name" || ' (' || r.rn || ')'
   FROM (SELECT "id", row_number() OVER (PARTITION BY lower("name")
         ORDER BY "created_at","id") AS rn FROM "t") AS r
   WHERE x."id" = r."id" AND r.rn > 1;
   --> statement-breakpoint
   CREATE UNIQUE INDEX "t_name_unique" ON "t" USING btree (lower("name"));
   ```

   Editing the **newly generated** file's body to add data SQL is fine; editing
   an **older, already-listed** migration is not.

## Notes

- A migration must apply cleanly both on a fresh database (full chain) and on a
  database already at the previous migration (only the new one runs). When a
  migration transforms or constrains existing data, verify the
  already-populated case, not just fresh.
- Keep destructive/transforming data SQL in the SAME migration as the schema
  change it enables, so the two can never be applied apart.
- Don't hand-edit `meta/_journal.json` or `meta/*_snapshot.json`; let `generate`
  own them. If they drift, regenerate rather than patching by hand.
