import { type SafeDatabase } from "@checkstack/backend-api";
import type { SecretMetadata } from "@checkstack/secrets-common";
import { eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import * as schema from "./schema";

export const VAULT_SECRET_BACKEND_ID = "vault";

type Db = SafeDatabase<typeof schema>;

export type SecretIndexRow = typeof schema.secretIndex.$inferSelect;

/** Map an index row to its public metadata. NEVER includes a value. */
export function toSecretMetadata(row: SecretIndexRow): SecretMetadata {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    // A Vault-indexed name always points at a value (we can't cheaply probe
    // Vault on a list without reading every secret). hasValue reflects "an
    // index entry exists"; the value itself is resolved lazily on get().
    hasValue: true,
    backend: VAULT_SECRET_BACKEND_ID,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * The name → Vault-location index. Defines the available secret-name set
 * for the Vault backend; holds NO values.
 */
export interface VaultIndexStore {
  lookup(name: string): Promise<SecretIndexRow | undefined>;
  list(): Promise<SecretMetadata[]>;
  upsert(input: {
    name: string;
    vaultPath: string;
    vaultKey: string;
    description?: string;
    createdBy?: string;
  }): Promise<void>;
  remove(name: string): Promise<void>;
}

export function createVaultIndexStore({ db }: { db: Db }): VaultIndexStore {
  return {
    async lookup(name) {
      const rows = await db
        .select()
        .from(schema.secretIndex)
        .where(eq(schema.secretIndex.name, name));
      return rows[0];
    },

    async list() {
      const rows = await db.select().from(schema.secretIndex);
      return rows.map((row) => toSecretMetadata(row));
    },

    async upsert({ name, vaultPath, vaultKey, description, createdBy }) {
      const existing = await db
        .select()
        .from(schema.secretIndex)
        .where(eq(schema.secretIndex.name, name));
      if (existing[0]) {
        await db
          .update(schema.secretIndex)
          .set({
            vaultPath,
            vaultKey,
            ...(description === undefined ? {} : { description }),
            updatedAt: new Date(),
          })
          .where(eq(schema.secretIndex.name, name));
        return;
      }
      await db.insert(schema.secretIndex).values({
        id: uuidv4(),
        name,
        vaultPath,
        vaultKey,
        description: description ?? null,
        createdBy: createdBy ?? null,
      });
    },

    async remove(name) {
      await db
        .delete(schema.secretIndex)
        .where(eq(schema.secretIndex.name, name));
    },
  };
}
