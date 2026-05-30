import { encrypt, decrypt, type SafeDatabase } from "@checkstack/backend-api";
import type { SecretBackend } from "@checkstack/secrets-backend";
import type { SecretMetadata } from "@checkstack/secrets-common";
import { eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import * as schema from "./schema";

/** Stable id for the default local backend. */
export const LOCAL_SECRET_BACKEND_ID = "local";

type Db = SafeDatabase<typeof schema>;

type SecretRow = typeof schema.secrets.$inferSelect;

/**
 * Map a stored row to its public metadata. Pure + exported so the
 * no-value-leak guarantee is unit-testable: the result carries `hasValue`
 * but never the encrypted/decrypted value.
 */
export function toSecretMetadata(row: SecretRow): SecretMetadata {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    hasValue: row.encryptedValue.length > 0,
    backend: LOCAL_SECRET_BACKEND_ID,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Build the default local {@link SecretBackend}: AES-256-GCM values in the
 * `secrets` table. `set`/`delete` are supported (read-write); `get`
 * decrypts a single value; `list` returns metadata only (never values).
 */
export function createLocalSecretBackend({ db }: { db: Db }): SecretBackend {
  return {
    id: LOCAL_SECRET_BACKEND_ID,

    async get({ name }) {
      const rows = await db
        .select()
        .from(schema.secrets)
        .where(eq(schema.secrets.name, name));
      const row = rows[0];
      if (!row) return;
      return decrypt(row.encryptedValue);
    },

    async set({ name, value, description, createdBy }) {
      const encryptedValue = encrypt(value);
      const existing = await db
        .select()
        .from(schema.secrets)
        .where(eq(schema.secrets.name, name));

      if (existing[0]) {
        await db
          .update(schema.secrets)
          .set({
            encryptedValue,
            // Only overwrite description when explicitly provided.
            ...(description === undefined ? {} : { description }),
            updatedAt: new Date(),
          })
          .where(eq(schema.secrets.name, name));
        return;
      }

      await db.insert(schema.secrets).values({
        id: uuidv4(),
        name,
        encryptedValue,
        description: description ?? null,
        createdBy: createdBy ?? null,
      });
    },

    async delete({ name }) {
      await db.delete(schema.secrets).where(eq(schema.secrets.name, name));
    },

    async list(): Promise<SecretMetadata[]> {
      const rows = await db.select().from(schema.secrets);
      return rows.map((row) => toSecretMetadata(row));
    },
  };
}
