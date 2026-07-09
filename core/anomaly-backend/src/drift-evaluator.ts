import type { Logger, SafeDatabase } from "@checkstack/backend-api";
import type { CatalogApi } from "@checkstack/catalog-common";
import type { NotificationApi } from "@checkstack/notification-common";
import type { InferClient } from "@checkstack/common";
import type { SignalService } from "@checkstack/signal-common";
import {
  ANOMALY_STATE_CHANGED,
  ANOMALY_TREND_DETECTED,
  detectDrift,
  resolveEffectiveConfig,
  isDriftFlatRelative,
  STABLE_DRIFT_RESOLUTION_RUN_COUNT,
  type AnomalyDirection,
  type AnomalyMetadata,
  type AnomalySettings,
  type FieldBaseline,
} from "@checkstack/anomaly-common";
import { and, eq, isNull } from "drizzle-orm";
import * as schema from "./schema";
import { dispatchAnomalyNotification } from "./notification";
import type { AnomalyCacheInvalidator } from "./router-cache";

/** Minimum analyzer-run count required before suspicious drift is confirmed. */
const DRIFT_CONFIRMATION_THRESHOLD = 2;
/** Minimum sample count before drift detection runs (matches spike cold-start). */
const DRIFT_MIN_SAMPLES = 24;

/** A row from the `anomalies` table. */
export type AnomalyRow = typeof schema.anomalies.$inferSelect;

/**
 * Load ALL existing 'drift' anomaly rows for a (system, config, env) slice in
 * ONE set-based SELECT, keyed by fieldPath. The baseline analyzer calls this
 * once per env before its field loop and threads the map into
 * {@link evaluateDrift} as `existingDriftRows`, so the per-field drift lookup is
 * an in-memory map read instead of an N+1 SELECT per field. Each field maps to a
 * distinct fieldPath (and thus a distinct row), so a preloaded snapshot is
 * behaviourally identical to a fresh per-field query.
 */
export async function loadExistingDriftRows({
  db,
  systemId,
  configurationId,
  environmentId,
}: {
  db: SafeDatabase<typeof schema>;
  systemId: string;
  configurationId: string;
  environmentId: string | null;
}): Promise<Map<string, AnomalyRow>> {
  const envPredicate =
    environmentId === null
      ? isNull(schema.anomalies.environmentId)
      : eq(schema.anomalies.environmentId, environmentId);
  const rows = await db
    .select()
    .from(schema.anomalies)
    .where(
      and(
        eq(schema.anomalies.systemId, systemId),
        eq(schema.anomalies.configurationId, configurationId),
        envPredicate,
        eq(schema.anomalies.kind, "drift"),
      ),
    );
  const map = new Map<string, AnomalyRow>();
  for (const row of rows) {
    map.set(row.fieldPath, row);
  }
  return map;
}

export interface EvaluateDriftInput {
  db: SafeDatabase<typeof schema>;
  logger: Logger;
  catalogClient: InferClient<typeof CatalogApi>;
  notificationClient: InferClient<typeof NotificationApi>;
  signalService?: SignalService;
  /**
   * Router-level anomaly list cache. Dropped after every write so a dashboard
   * refetching in response to `ANOMALY_STATE_CHANGED` does not read the
   * pre-transition list back out of the 15s cache.
   */
  routerCache?: AnomalyCacheInvalidator;
  systemId: string;
  configurationId: string;
  /**
   * Environment this drift was evaluated for (per-environment fan-out).
   * null = the env-less slice (no environment membership). The analyzer's
   * per-env loop threads it so the drift row is located/created by
   * `(systemId, configurationId, environmentId, fieldPath, kind)` - a drift for
   * this check in env A is a distinct row from env B, mirroring the spike
   * detector and the per-env baseline.
   */
  environmentId: string | null;
  fieldPath: string;
  baseline: FieldBaseline;
  /** Direction declared by the schema for this field, if any. */
  schemaDirection?: AnomalyDirection;
  /** Schema-declared sensitivity multiplier (plugin author default). */
  schemaSensitivity?: number;
  /** Schema-declared confirmation window (plugin author default). */
  schemaConfirmationWindow?: number;
  /** Schema-declared drift toggle (plugin author default). */
  schemaDriftEnabled?: boolean;
  /** Schema-declared drift threshold sigma multiplier (plugin author default). */
  schemaDriftThreshold?: number;
  /** Schema-declared practical-significance floor on absolute change. */
  schemaMinAbsoluteDelta?: number;
  /** Schema-declared practical-significance floor on relative change. */
  schemaMinRelativeDelta?: number;
  templateConfig?: AnomalySettings;
  assignmentConfig?: Partial<AnomalySettings>;
  /**
   * Optional batch-preloaded map of existing 'drift' rows keyed by fieldPath for
   * this (system, config, env) slice (see {@link loadExistingDriftRows}). When
   * provided, the existing-row lookup reads from this map instead of issuing its
   * own per-field SELECT — the baseline analyzer preloads these set-based to
   * avoid an N+1. When omitted (standalone use), evaluateDrift resolves the row
   * itself.
   */
  existingDriftRows?: Map<string, AnomalyRow>;
}

/**
 * Drives the drift state machine for a single field at the cadence of the
 * background baseline analyzer. Counterpart to the spike `processCheckCompleted`
 * inline detector — same lifecycle, same `anomalies` table, but `kind = 'drift'`.
 *
 * Idempotent under repeat analyzer runs: if drift is detected and no row exists,
 * a suspicious row is created; subsequent runs increment the count, transition
 * to anomaly when the threshold is reached, and delete/recover when slope falls
 * back inside the band.
 */
export async function evaluateDrift({
  db,
  logger,
  catalogClient,
  notificationClient,
  signalService,
  routerCache,
  systemId,
  configurationId,
  environmentId,
  fieldPath,
  baseline,
  schemaDirection,
  schemaSensitivity,
  schemaConfirmationWindow,
  schemaDriftEnabled,
  schemaDriftThreshold,
  schemaMinAbsoluteDelta,
  schemaMinRelativeDelta,
  templateConfig,
  assignmentConfig,
  existingDriftRows,
}: EvaluateDriftInput): Promise<void> {
  const {
    enabled,
    sensitivity,
    direction: configDirection,
    driftEnabled,
    driftThreshold,
    minAbsoluteDelta,
    minRelativeDelta,
  } = resolveEffectiveConfig(fieldPath, templateConfig, assignmentConfig, {
    sensitivity: schemaSensitivity,
    confirmationWindow: schemaConfirmationWindow,
    driftEnabled: schemaDriftEnabled,
    driftThreshold: schemaDriftThreshold,
    minAbsoluteDelta: schemaMinAbsoluteDelta,
    minRelativeDelta: schemaMinRelativeDelta,
  });

  const direction = configDirection ?? schemaDirection;

  // Skip when feature is off, direction unsupported, or in cold start.
  if (!enabled || !driftEnabled) return;
  if (!direction || direction === "dominance") return;
  if (baseline.sampleCount < DRIFT_MIN_SAMPLES) return;

  const driftResult = detectDrift({
    slope: baseline.trendSlope,
    stdDev: baseline.stdDev,
    sampleCount: baseline.sampleCount,
    direction,
    sensitivity,
    threshold: driftThreshold,
    mean: baseline.mean,
    minAbsoluteDelta,
    minRelativeDelta,
  });

  // Resolve the per-env drift row. When the caller batch-preloaded the drift
  // rows (analyzer path), read the row from that map in memory; otherwise issue
  // the per-field SELECT. The env predicate mirrors the per-env baseline lookup
  // so a drift for this check in env A is a distinct row from env B.
  let existing: AnomalyRow | undefined;
  if (existingDriftRows) {
    existing = existingDriftRows.get(fieldPath);
  } else {
    const envPredicate =
      environmentId === null
        ? isNull(schema.anomalies.environmentId)
        : eq(schema.anomalies.environmentId, environmentId);
    [existing] = await db
      .select()
      .from(schema.anomalies)
      .where(
        and(
          eq(schema.anomalies.systemId, systemId),
          eq(schema.anomalies.configurationId, configurationId),
          envPredicate,
          eq(schema.anomalies.fieldPath, fieldPath),
          eq(schema.anomalies.kind, "drift"),
        ),
      )
      .limit(1);
  }

  if (driftResult.drifting) {
    if (!existing) {
      const [inserted] = await db
        .insert(schema.anomalies)
        .values({
          systemId,
          configurationId,
          environmentId,
          fieldPath,
          kind: "drift",
          state: "suspicious",
          direction: driftResult.driftDirection,
          baselineValue: baseline.mean,
          baselineStdDev: baseline.stdDev,
          observedValue: baseline.mean.toString(),
          deviation: driftResult.deviationSigmas,
          suspiciousRunCount: 1,
          confirmationThreshold: DRIFT_CONFIRMATION_THRESHOLD,
        })
        .returning({ id: schema.anomalies.id });

      if (inserted) {
        await routerCache?.invalidateAnomalies();
      }

      if (signalService && inserted) {
        await signalService.broadcast(ANOMALY_STATE_CHANGED, {
          systemId,
          anomalyId: inserted.id,
          newState: "suspicious",
        });
      }
      return;
    }

    if (existing.state === "suspicious") {
      const newCount = existing.suspiciousRunCount + 1;
      if (newCount >= existing.confirmationThreshold) {
        await db
          .update(schema.anomalies)
          .set({
            state: "anomaly",
            confirmedAt: new Date(),
            observedValue: baseline.mean.toString(),
            deviation: driftResult.deviationSigmas,
          })
          .where(eq(schema.anomalies.id, existing.id));
        logger.debug(`Drift confirmed for ${systemId} on ${fieldPath}`);

        await routerCache?.invalidateAnomalies();

        if (signalService) {
          await signalService.broadcast(ANOMALY_STATE_CHANGED, {
            systemId,
            anomalyId: existing.id,
            newState: "anomaly",
          });
          await signalService.broadcast(ANOMALY_TREND_DETECTED, {
            systemId,
            anomalyId: existing.id,
            fieldPath,
          });
        }

        await dispatchAnomalyNotification({
          action: "drift_confirmed",
          systemId,
          environmentId,
          fieldPath,
          observedValue: baseline.mean,
          baselineMean: baseline.mean,
          projectedChange: driftResult.projectedChange,
          catalogClient,
          notificationClient,
          db,
          logger,
        });
        return;
      }
      await db
        .update(schema.anomalies)
        .set({
          suspiciousRunCount: newCount,
          observedValue: baseline.mean.toString(),
          deviation: driftResult.deviationSigmas,
        })
        .where(eq(schema.anomalies.id, existing.id));
      return;
    }

    if (existing.state === "anomaly") {
      // PART A (drift self-resolution): the slope-based detector still reports
      // drift because the 7-day window straddles the old and new regimes, but
      // if the *projected change relative to the (new) mean* has gone flat for
      // several consecutive analyzer runs, the metric has settled at its new
      // level — resolve independently of the slow window catching up. The
      // run-count lives on the row's metadata (shared Postgres) so it survives
      // across whichever pod claims the analyzer job.
      const metadata = (existing.metadata ?? {}) as AnomalyMetadata;
      const flat = isDriftFlatRelative({
        projectedChange: driftResult.projectedChange,
        mean: baseline.mean,
      });
      const stableDriftRunCount = flat
        ? (metadata.stableDriftRunCount ?? 0) + 1
        : 0;

      if (stableDriftRunCount >= STABLE_DRIFT_RESOLUTION_RUN_COUNT) {
        await db
          .update(schema.anomalies)
          .set({
            state: "recovered",
            recoveredAt: new Date(),
            observedValue: baseline.mean.toString(),
            deviation: driftResult.deviationSigmas,
            metadata: { ...metadata, stableDriftRunCount: 0 },
          })
          .where(eq(schema.anomalies.id, existing.id));
        logger.debug(
          `Drift self-resolved (settled at new level) for ${systemId} on ${fieldPath}`,
        );

        await routerCache?.invalidateAnomalies();

        if (signalService) {
          await signalService.broadcast(ANOMALY_STATE_CHANGED, {
            systemId,
            anomalyId: existing.id,
            newState: "recovered",
          });
        }

        await dispatchAnomalyNotification({
          action: "drift_recovered",
          systemId,
          environmentId,
          fieldPath,
          observedValue: baseline.mean,
          baselineMean: baseline.mean,
          catalogClient,
          notificationClient,
          db,
          logger,
        });
        return;
      }

      await db
        .update(schema.anomalies)
        .set({
          observedValue: baseline.mean.toString(),
          deviation: driftResult.deviationSigmas,
          metadata: { ...metadata, stableDriftRunCount },
        })
        .where(eq(schema.anomalies.id, existing.id));
      return;
    }

    // For 'recovered' rows: leave the historical record alone — a fresh drift
    // would create a new row on the next cycle.
    return;
  }

  // Not drifting now.
  if (!existing) return;

  if (existing.state === "suspicious") {
    await db.delete(schema.anomalies).where(eq(schema.anomalies.id, existing.id));

    // A cleared suspicion is a dashboard-visible state going away, so it needs
    // the same cache-drop + signal every other transition does — otherwise the
    // "Suspicious behaviour" badge/signal sticks around until an incidental
    // refetch.
    await routerCache?.invalidateAnomalies();

    if (signalService) {
      await signalService.broadcast(ANOMALY_STATE_CHANGED, {
        systemId,
        anomalyId: existing.id,
        newState: "cleared",
      });
    }
    return;
  }

  if (existing.state === "anomaly") {
    await db
      .update(schema.anomalies)
      .set({
        state: "recovered",
        recoveredAt: new Date(),
        observedValue: baseline.mean.toString(),
        suppressedAt: null,
        suppressedValue: null,
        suppressedBaseline: null,
      })
      .where(eq(schema.anomalies.id, existing.id));
    logger.debug(`Drift recovered for ${systemId} on ${fieldPath}`);

    await routerCache?.invalidateAnomalies();

    if (signalService) {
      await signalService.broadcast(ANOMALY_STATE_CHANGED, {
        systemId,
        anomalyId: existing.id,
        newState: "recovered",
      });
    }

    await dispatchAnomalyNotification({
      action: "drift_recovered",
      systemId,
      environmentId,
      fieldPath,
      observedValue: baseline.mean,
      baselineMean: baseline.mean,
      catalogClient,
      notificationClient,
      db,
      logger,
    });
  }
}
