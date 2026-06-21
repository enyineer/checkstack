#!/usr/bin/env bun
/**
 * Operator command: re-encrypt every stored at-rest secret onto the CURRENT
 * primary `ENCRYPTION_MASTER_KEY`.
 *
 * ## When to run it
 *
 * After rotating the encryption key:
 *   1. Generate a new key.
 *   2. Set `ENCRYPTION_MASTER_KEY` to the NEW key and move the OLD key into
 *      `ENCRYPTION_MASTER_KEY_PREVIOUS` (comma-separated if more than one).
 *   3. Run this command - it decrypts every stored value with whichever
 *      configured key authenticates and re-encrypts it with the new primary.
 *   4. Once it reports zero failures, you can DROP the old key from
 *      `ENCRYPTION_MASTER_KEY_PREVIOUS`.
 *
 * ## What it covers
 *
 * - The local secret backend `secrets` table (`encrypted_value` column).
 * - Config-service `x-secret` fields stored in `plugin_configs` (`data` JSON):
 *   every structurally-encrypted string value, detected with the strict
 *   `isEncrypted` check.
 *
 * ## What it does NOT cover
 *
 * - Secrets in EXTERNAL backends (e.g. Vault) - rotate those through the
 *   backend's own mechanism; this module's key never encrypted them.
 *
 * Run:
 *   ENCRYPTION_MASTER_KEY=<new> \
 *   ENCRYPTION_MASTER_KEY_PREVIOUS=<old> \
 *   DATABASE_URL=postgres://... \
 *   bun run core/backend/scripts/reencrypt-secrets.ts
 *
 * Never logs key material, ciphertext, or plaintext - only counts and the row
 * identifiers (id / pluginId/configId) of failures.
 */
import { sql } from "drizzle-orm";
import { z } from "zod";
import { extractErrorMessage } from "@checkstack/common";
import { db, adminPool, lockPool } from "../src/db";
import { pluginConfigs } from "../src/schema";
import { rootLogger } from "../src/logger";
import {
  reencryptAllSecrets,
  type PluginConfigRow,
  type ReencryptStore,
  type SecretValueRow,
} from "../src/services/reencrypt-secrets";

/**
 * Row shape returned by the raw `secrets` query. The local secret backend owns
 * that table in a DOMAIN package; this operator script reaches it via raw SQL
 * rather than importing the domain package, keeping the platform->domain
 * dependency direction clean.
 */
const secretRowSchema = z.object({
  id: z.string(),
  encrypted_value: z.string(),
});

/** Build a {@link ReencryptStore} backed by the real backend Postgres. */
const createDbStore = (): ReencryptStore => ({
  async listSecretRows(): Promise<SecretValueRow[]> {
    // `to_regclass` returns NULL when the table is absent (e.g. the local
    // secret backend was never installed), so we skip cleanly instead of
    // erroring.
    const exists = await db.execute<{ present: string | null }>(
      sql`SELECT to_regclass('public.secrets')::text AS present`
    );
    if (!exists.rows[0]?.present) return [];

    const result = await db.execute<{ id: string; encrypted_value: string }>(
      sql`SELECT id, encrypted_value FROM secrets`
    );
    return result.rows.map((row) => {
      const parsed = secretRowSchema.parse(row);
      return { id: parsed.id, encryptedValue: parsed.encrypted_value };
    });
  },

  async updateSecretValue({ id, encryptedValue }): Promise<void> {
    await db.execute(
      sql`UPDATE secrets SET encrypted_value = ${encryptedValue}, updated_at = now() WHERE id = ${id}`
    );
  },

  async listPluginConfigRows(): Promise<PluginConfigRow[]> {
    const rows = await db
      .select({
        pluginId: pluginConfigs.pluginId,
        configId: pluginConfigs.configId,
        data: pluginConfigs.data,
      })
      .from(pluginConfigs);
    return rows.map((row) => ({
      pluginId: row.pluginId,
      configId: row.configId,
      data: row.data,
    }));
  },

  async updatePluginConfigData({ pluginId, configId, data }): Promise<void> {
    await db
      .update(pluginConfigs)
      .set({ data: data as Record<string, unknown>, updatedAt: new Date() })
      .where(
        sql`${pluginConfigs.pluginId} = ${pluginId} AND ${pluginConfigs.configId} = ${configId}`
      );
  },
});

const main = async (): Promise<void> => {
  rootLogger.info("Re-encrypting all at-rest secrets onto the primary key...");

  const result = await reencryptAllSecrets({ store: createDbStore() });

  rootLogger.info("Local secret backend (secrets table)", {
    scanned: result.secrets.scanned,
    reencrypted: result.secrets.reencrypted,
    skipped: result.secrets.skipped,
    failed: result.secrets.failed.length,
  });
  rootLogger.info("Config-service x-secret fields (plugin_configs table)", {
    scanned: result.pluginConfigs.scanned,
    reencrypted: result.pluginConfigs.reencrypted,
    skipped: result.pluginConfigs.skipped,
    failed: result.pluginConfigs.failed.length,
  });

  const failures = [...result.secrets.failed, ...result.pluginConfigs.failed];
  if (failures.length > 0) {
    rootLogger.error(
      "Some secrets could not be decrypted with ANY configured key. Do NOT drop the previous key yet; investigate these rows.",
      { failedRows: failures }
    );
    await closePools();
    process.exit(1);
  }

  rootLogger.info(
    "All secrets re-encrypted onto the primary key. You can now drop the old key from ENCRYPTION_MASTER_KEY_PREVIOUS."
  );
  await closePools();
};

const closePools = async (): Promise<void> => {
  await Promise.allSettled([adminPool.end(), lockPool.end()]);
};

try {
  await main();
} catch (error: unknown) {
  rootLogger.error("Re-encryption run failed", {
    error: extractErrorMessage(error),
  });
  await closePools();
  process.exit(1);
}
