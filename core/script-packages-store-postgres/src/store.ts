import { eq } from "drizzle-orm";
import type { SafeDatabase } from "@checkstack/backend-api";
import type { BlobStore } from "@checkstack/script-packages-backend";
import { scriptPackageBlobData } from "./schema";
import { encodeBlob, decodeBlob } from "./codec";

export const POSTGRES_BLOB_STORE_ID = "postgres";

type Schema = { scriptPackageBlobData: typeof scriptPackageBlobData };

/**
 * Postgres-backed {@link BlobStore} - the default, zero-extra-infra
 * backend. Content-addressed: `put` of an already-present integrity is a
 * no-op (identical bytes by definition), so we use `onConflictDoNothing`.
 */
export function createPostgresBlobStore(
  db: SafeDatabase<Schema>,
): BlobStore {
  return {
    id: POSTGRES_BLOB_STORE_ID,

    async put({ integrity, bytes }) {
      await db
        .insert(scriptPackageBlobData)
        .values({
          integrity,
          data: encodeBlob(bytes),
          sizeBytes: bytes.byteLength,
        })
        .onConflictDoNothing({ target: scriptPackageBlobData.integrity });
    },

    async get({ integrity }) {
      const rows = await db
        .select({ data: scriptPackageBlobData.data })
        .from(scriptPackageBlobData)
        .where(eq(scriptPackageBlobData.integrity, integrity))
        .limit(1);
      const row = rows[0];
      return row ? decodeBlob(row.data) : undefined;
    },

    async has({ integrity }) {
      const rows = await db
        .select({ integrity: scriptPackageBlobData.integrity })
        .from(scriptPackageBlobData)
        .where(eq(scriptPackageBlobData.integrity, integrity))
        .limit(1);
      return rows.length > 0;
    },

    async delete({ integrity }) {
      await db
        .delete(scriptPackageBlobData)
        .where(eq(scriptPackageBlobData.integrity, integrity));
    },

    async list() {
      const rows = await db
        .select({ integrity: scriptPackageBlobData.integrity })
        .from(scriptPackageBlobData);
      return rows.map((r) => r.integrity);
    },
  };
}
