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
  type AnomalyDirection,
  type AnomalySettings,
  type FieldBaseline,
} from "@checkstack/anomaly-common";
import { and, eq } from "drizzle-orm";
import * as schema from "./schema";
import { dispatchAnomalyNotification } from "./notification";

/** Minimum analyzer-run count required before suspicious drift is confirmed. */
const DRIFT_CONFIRMATION_THRESHOLD = 2;
/** Minimum sample count before drift detection runs (matches spike cold-start). */
const DRIFT_MIN_SAMPLES = 24;

export interface EvaluateDriftInput {
  db: SafeDatabase<typeof schema>;
  logger: Logger;
  catalogClient: InferClient<typeof CatalogApi>;
  notificationClient: InferClient<typeof NotificationApi>;
  signalService?: SignalService;
  systemId: string;
  configurationId: string;
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
  systemId,
  configurationId,
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

  const [existing] = await db
    .select()
    .from(schema.anomalies)
    .where(
      and(
        eq(schema.anomalies.systemId, systemId),
        eq(schema.anomalies.configurationId, configurationId),
        eq(schema.anomalies.fieldPath, fieldPath),
        eq(schema.anomalies.kind, "drift"),
      ),
    )
    .limit(1);

  if (driftResult.drifting) {
    if (!existing) {
      const [inserted] = await db
        .insert(schema.anomalies)
        .values({
          systemId,
          configurationId,
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
        logger.warn(`Drift confirmed for ${systemId} on ${fieldPath}`);

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
      await db
        .update(schema.anomalies)
        .set({
          observedValue: baseline.mean.toString(),
          deviation: driftResult.deviationSigmas,
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
    return;
  }

  if (existing.state === "anomaly") {
    await db
      .update(schema.anomalies)
      .set({
        state: "recovered",
        recoveredAt: new Date(),
        observedValue: baseline.mean.toString(),
      })
      .where(eq(schema.anomalies.id, existing.id));
    logger.info(`Drift recovered for ${systemId} on ${fieldPath}`);

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
