/**
 * One-time, idempotent, parity-verified, REVERSIBLE migration that moves
 * inline connection credentials onto the secrets platform.
 *
 * For each existing connection of each provider that has a
 * `connectionSchema`:
 *   1. Back up the current raw config to a backup ConfigService entry
 *      (only if no backup exists yet) so the pre-migration value is
 *      recoverable.
 *   2. Extract inline `x-secret` values into internal secrets (local
 *      backend) via `extractInlineCredentials`, producing a config whose
 *      secret fields are internal-ref markers.
 *   3. Verify parity: inflate the rewritten config back through the unified
 *      channel and confirm every secret field resolves to the SAME value as
 *      the original. Only if parity holds, rewrite the stored config.
 *
 * Idempotent: a config already reference-ized (markers / `${{ }}`) extracts
 * nothing and is left as-is. Guarded across boots by the per-connection
 * backup entry + the marker form. Never drops a value until the platform
 * copy reads back identically.
 */
import { z } from "zod";
import type { ConfigService, Logger } from "@checkstack/backend-api";
import { extractErrorMessage } from "@checkstack/common";
import type {
  SecretResolverService,
  InternalSecretsService,
} from "@checkstack/secrets-backend";
import {
  extractInlineCredentials,
  inflateConnectionCredentials,
} from "./connection-credentials";

const BACKUP_VERSION = 1;

/** Backup ConfigService key for a connection's pre-migration raw config. */
function backupKey(providerId: string, connectionId: string): string {
  const sanitized = providerId.replaceAll(".", "_");
  return `integration_connection_credbackup_${sanitized}_${connectionId}`;
}

const BackupSchema = z.object({
  config: z.record(z.string(), z.unknown()),
  migratedAt: z.coerce.date(),
});

export interface ConnectionForMigration {
  providerId: string;
  connectionId: string;
  /** Provider connection schema (Zod) used to find x-secret fields. */
  schema: z.ZodTypeAny;
  /** Provider connectionSchema version (for ConfigService set). */
  schemaVersion: number;
  /** Current raw stored config. */
  config: Record<string, unknown>;
}

export interface MigrationResult {
  total: number;
  migrated: number;
  skipped: number;
  failed: number;
}

/**
 * Run the credential migration over the given connections.
 *
 * `loadConnections` yields every connection (with its provider schema) so
 * this stays decoupled from the store internals; `persistConfig` writes the
 * rewritten config back through the store's normal path.
 */
export async function migrateConnectionCredentials(params: {
  configService: ConfigService;
  internalSecrets: InternalSecretsService;
  secretResolver: SecretResolverService;
  logger: Logger;
  loadConnections: () => Promise<ConnectionForMigration[]>;
  persistConfig: (input: {
    providerId: string;
    connectionId: string;
    schemaVersion: number;
    config: Record<string, unknown>;
  }) => Promise<void>;
}): Promise<MigrationResult> {
  const {
    configService,
    internalSecrets,
    secretResolver,
    logger,
    loadConnections,
    persistConfig,
  } = params;

  const connections = await loadConnections();
  const result: MigrationResult = {
    total: connections.length,
    migrated: 0,
    skipped: 0,
    failed: 0,
  };

  for (const conn of connections) {
    try {
      // 1. Back up the original raw config (idempotent — only once).
      const bKey = backupKey(conn.providerId, conn.connectionId);
      const existingBackup = await configService.get(
        bKey,
        BackupSchema,
        BACKUP_VERSION,
      );
      if (!existingBackup) {
        await configService.set(bKey, BackupSchema, BACKUP_VERSION, {
          config: conn.config,
          migratedAt: new Date(),
        });
      }

      // 2. Extract inline secret values into internal secrets.
      const { config: rewritten, extracted } = await extractInlineCredentials({
        providerId: conn.providerId,
        connectionId: conn.connectionId,
        config: conn.config,
        schema: conn.schema,
        internalSecrets,
      });

      if (extracted === 0) {
        // Already reference-ized (or no secret fields) — nothing to do.
        result.skipped++;
        continue;
      }

      // 3. Parity check: inflate the rewritten config and confirm the
      //    secret fields resolve back to the ORIGINAL values before we
      //    overwrite the stored config (reversible guarantee).
      const original = await inflateConnectionCredentials({
        providerId: conn.providerId,
        connectionId: conn.connectionId,
        config: conn.config,
        schema: conn.schema,
        deps: { secretResolver, internalSecrets },
      });
      const roundTripped = await inflateConnectionCredentials({
        providerId: conn.providerId,
        connectionId: conn.connectionId,
        config: rewritten,
        schema: conn.schema,
        deps: { secretResolver, internalSecrets },
      });
      if (
        JSON.stringify(original.config) !== JSON.stringify(roundTripped.config)
      ) {
        logger.error(
          `Credential migration parity check FAILED for connection ${conn.connectionId}; leaving it unchanged.`,
        );
        result.failed++;
        continue;
      }

      // Parity proven — rewrite the stored config to the reference form.
      await persistConfig({
        providerId: conn.providerId,
        connectionId: conn.connectionId,
        schemaVersion: conn.schemaVersion,
        config: rewritten,
      });
      result.migrated++;
    } catch (error) {
      logger.error(
        `Credential migration failed for connection ${conn.connectionId}: ${extractErrorMessage(error)}`,
      );
      result.failed++;
    }
  }

  if (result.migrated > 0 || result.failed > 0) {
    logger.info(
      `Connection credential migration: ${result.migrated} migrated, ${result.skipped} skipped, ${result.failed} failed (of ${result.total}).`,
    );
  }
  return result;
}
