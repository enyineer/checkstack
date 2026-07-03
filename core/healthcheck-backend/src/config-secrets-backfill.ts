import { eq } from "drizzle-orm";
import type {
  AdvisoryLockService,
  HealthCheckRegistry,
  CollectorRegistry,
  Logger,
  SafeDatabase,
} from "@checkstack/backend-api";
import type { InternalSecretsService } from "@checkstack/secrets-backend";
import type { CollectorConfigEntry } from "@checkstack/healthcheck-common";
import { healthCheckConfigurations } from "./schema";
import * as schema from "./schema";
import {
  extractConfigurationSecrets,
  healthcheckConfigLockKey,
} from "./config-secrets";

/**
 * One-time (idempotent) boot backfill: move inline `x-secret` values that
 * pre-date the config-secrets channel out of stored health-check
 * configurations and into internal secrets.
 *
 * Rows written after the channel shipped hold only markers / `${{ secrets.* }}`
 * references, which the extraction walk skips - so re-running is a no-op and
 * the job is safe to run on EVERY boot. A cross-pod advisory lock ensures a
 * single pod performs the scan; the others skip (the winner's result is in
 * the shared DB either way).
 *
 * Fail-open per row: one row with an unregistered strategy (plugin removed)
 * or a broken shape must not wedge boot - it is logged and left as-is; the
 * executor treats its bare literal exactly as before (legacy pass-through).
 */
export async function backfillConfigSecrets({
  db,
  registry,
  collectorRegistry,
  internalSecrets,
  advisoryLock,
  logger,
}: {
  db: SafeDatabase<typeof schema>;
  registry: HealthCheckRegistry;
  collectorRegistry: CollectorRegistry;
  internalSecrets: InternalSecretsService;
  advisoryLock: AdvisoryLockService;
  logger: Logger;
}): Promise<void> {
  const lock = await advisoryLock.tryAcquire("healthcheck:config-secrets-backfill");
  if (!lock) {
    logger.debug("Config-secrets backfill already running on another pod, skipping");
    return;
  }

  try {
    const rows = await db.select().from(healthCheckConfigurations);
    let migratedRows = 0;
    let movedValues = 0;

    for (const { id: rowId } of rows) {
      // Serialize each row's read-modify-write under the SAME per-config lock
      // updateConfiguration uses, and re-read the row INSIDE the lock. Without
      // this the backfill could write back a pre-lock snapshot over a concurrent
      // edit - resurrecting a just-rotated secret and reverting the edit.
      await advisoryLock.withXactLock({
        key: healthcheckConfigLockKey(rowId),
        fn: async () => {
          const [row] = await db
            .select()
            .from(healthCheckConfigurations)
            .where(eq(healthCheckConfigurations.id, rowId));
          if (!row) return; // deleted between the scan and the lock

          // An unregistered strategy has no schema: its own strategy-level
          // legacy secrets stay as-is (pass-through, as before), but we still
          // migrate every REGISTERED collector's inline secrets rather than
          // skipping the whole row - leaving those plaintext would defeat the
          // backfill. extractConfigurationSecrets handles the undefined schema.
          const strategySchema =
            registry.getStrategy(row.strategyId)?.config.schema;
          if (!strategySchema) {
            logger.warn(
              `Config-secrets backfill: strategy ${row.strategyId} not registered; leaving its strategy config as-is and migrating collector secrets for configuration ${row.id}`,
            );
          }

          try {
            const collectors: CollectorConfigEntry[] | undefined =
              row.collectors ?? undefined;
            const extracted = await extractConfigurationSecrets({
              configurationId: row.id,
              strategySchema,
              config: row.config as Record<string, unknown>,
              collectors,
              getCollectorSchema: (collectorId) =>
                collectorRegistry.getCollector(collectorId)?.collector.config
                  .schema,
              internalSecrets,
            });
            if (extracted.extracted === 0) return;

            await db
              .update(healthCheckConfigurations)
              .set({
                config: extracted.config,
                collectors: extracted.collectors,
                updatedAt: new Date(),
              })
              .where(eq(healthCheckConfigurations.id, row.id));
            migratedRows++;
            movedValues += extracted.extracted;
          } catch (error) {
            logger.warn(
              `Config-secrets backfill: failed for configuration ${row.id}, leaving as-is`,
              error,
            );
          }
        },
      });
    }

    if (migratedRows > 0) {
      logger.info(
        `Config-secrets backfill: moved ${movedValues} inline secret value(s) from ${migratedRows} configuration(s) into the internal secret store`,
      );
    }
  } finally {
    await lock.release();
  }
}
