import { pgTable, text, bigint, timestamp } from "drizzle-orm/pg-core";

/**
 * Postgres blob store schema.
 *
 * One row per content-addressed blob, keyed by integrity. Compressed blob
 * bytes are stored base64-encoded in a `text` column - following the
 * existing repo convention (`core/backend/src/schema.ts` does the same for
 * plugin tarballs) because Drizzle's `bytea` handling is awkward and base64
 * `text` is portable. Blobs are bounded by the size guardrail and the
 * lightweight-pure-JS regime, so the ~33% base64 overhead is acceptable for
 * the zero-extra-infra default backend.
 */
export const scriptPackageBlobData = pgTable("script_package_blob_data", {
  integrity: text("integrity").primaryKey(),
  /** base64-encoded compressed blob bytes. */
  data: text("data").notNull(),
  sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
