import type { SafeDatabase } from "@checkstack/backend-api";
import type { CacheProvider } from "@checkstack/cache-api";
import * as schema from "./schema";
import { eq, and } from "drizzle-orm";
import {
  computeThresholds,
  isAnomalous,
  isCategoricalAnomalous,
  resolveEffectiveConfig,
  type FieldBaseline,
} from "@checkstack/anomaly-common";
import type { Logger } from "@checkstack/backend-api";
import type { CatalogApi } from "@checkstack/catalog-common";
import type { InferClient } from "@checkstack/common";
import { AnomalyService } from "./service";
import type { AnomalySettings, AnomalyDirection } from "@checkstack/anomaly-common";
import type { SignalService } from "@checkstack/signal-common";
import { ANOMALY_STATE_CHANGED } from "@checkstack/anomaly-common";
import { dispatchAnomalyNotification } from "./notification";

// ─────────────────────────────────────────────────────────────────────────────
// Inline Fast Detector (Phase 1)
// ─────────────────────────────────────────────────────────────────────────────

import type { CollectorRegistry } from "@checkstack/backend-api";
import { getHealthResultMeta } from "@checkstack/healthcheck-common";
import type { z } from "@checkstack/backend-api";

export async function processCheckCompleted({
  systemId,
  configurationId,
  status,
  latencyMs: _latencyMs,
  result,
  timestamp: _timestamp,
  db,
  cache,
  logger,
  catalogClient,
  signalService,
  collectorRegistry,
}: {
  systemId: string;
  configurationId: string;
  status: string;
  latencyMs: number | undefined;
  result: Record<string, unknown> | undefined;
  timestamp: string;
  db: SafeDatabase<typeof schema>;
  cache: CacheProvider;
  logger: Logger;
  catalogClient: InferClient<typeof CatalogApi>;
  signalService?: SignalService;
  collectorRegistry: CollectorRegistry;
}) {
  if (!result || status !== "healthy") {
    // Only analyze successful results for anomalies
    return;
  }

  const fieldsToCheck: {
    path: string;
    value: number | string | boolean;
    collectorId: string;
    fieldName: string;
  }[] = [];

  // `result` here is specifically the `collectors` dictionary where keys are UUIDs
  // e.g. { "uuid-1234": { "_collectorId": "healthcheck-http.request", "responseTimeMs": 50 } }
  for (const collectorData of Object.values(result)) {
    if (typeof collectorData === "object" && collectorData !== null) {
      const data = collectorData as Record<string, unknown>;
      const realCollectorId = data._collectorId;

      if (typeof realCollectorId === "string") {
        for (const [fieldName, value] of Object.entries(data)) {
          if (fieldName.startsWith("_")) continue;
          if (
            typeof value === "number" ||
            typeof value === "string" ||
            typeof value === "boolean"
          ) {
            fieldsToCheck.push({
              path: `collectors.${realCollectorId}.${fieldName}`,
              value,
              collectorId: realCollectorId,
              fieldName,
            });
          }
        }
      }
    }
  }

  if (fieldsToCheck.length === 0) return;

  // F2 fix: Fetch config ONCE above the field loop (was N+1 inside the loop)
  const anomalyService = new AnomalyService(db);
  let templateConfig: AnomalySettings | undefined;
  let assignmentConfig: Partial<AnomalySettings> | undefined;
  try {
    const templateRecord =
      await anomalyService.getAnomalyConfig(configurationId);
    templateConfig = templateRecord.data;
    const assignmentRecord = await anomalyService.getAnomalyAssignmentConfig(
      systemId,
      configurationId,
    );
    assignmentConfig = assignmentRecord?.data ?? undefined;
  } catch (error) {
    logger.warn(
      `Failed to fetch anomaly configuration for ${configurationId}`,
      error,
    );
  }

  // Check each field
  for (const { path, value, collectorId, fieldName } of fieldsToCheck) {
    const cacheKey = `baseline:${configurationId}:${systemId}:${path}`;
    let baseline = await cache.get<FieldBaseline>(cacheKey);

    if (!baseline) {
      const [dbBaseline] = await db
        .select()
        .from(schema.anomalyBaselines)
        .where(
          and(
            eq(schema.anomalyBaselines.systemId, systemId),
            eq(schema.anomalyBaselines.configurationId, configurationId),
            eq(schema.anomalyBaselines.fieldPath, path),
          ),
        )
        .limit(1);

      if (dbBaseline) {
        baseline = {
          mean: dbBaseline.mean,
          stdDev: dbBaseline.stdDev,
          trendSlope: dbBaseline.trendSlope,
          sampleCount: dbBaseline.sampleCount,
          computedAt: dbBaseline.computedAt.toISOString(),
          dominantValue: dbBaseline.dominantValue ?? undefined,
          dominantRatio: dbBaseline.dominantRatio ?? undefined,
        };
        await cache.set(cacheKey, baseline, 1000 * 60 * 60); // 1 hour TTL
      }
    }

    if (!baseline) {
      continue; // Learning phase (no baseline yet)
    }

    const {
      enabled: effectiveEnabled,
      sensitivity: effectiveSensitivity,
      confirmationWindow: effectiveConfirmation,
      direction: effectiveDirection,
    } = resolveEffectiveConfig(path, templateConfig, assignmentConfig);

    if (!effectiveEnabled) {
      continue;
    }

    let schemaDirection: AnomalyDirection | undefined;
    const collector = collectorRegistry.getCollector(collectorId);
    if (collector) {
      const collectorSchema = collector.collector.result.schema;
      if ("shape" in collectorSchema) {
        const shape = collectorSchema.shape as Record<string, z.ZodTypeAny>;
        const fieldSchema = shape[fieldName];
        if (fieldSchema) {
          const meta = getHealthResultMeta(fieldSchema);
          schemaDirection = meta?.["x-anomaly-direction"];
        }
      }
    }

    const direction = effectiveDirection ?? schemaDirection;

    if (!direction) {
      continue; // No direction configured (e.g. explicitly disabled in schema)
    }

    let anomalous = false;
    let deviation = 0;

    if (direction === "dominance") {
      anomalous = isCategoricalAnomalous(
        value,
        baseline.dominantValue,
        baseline.dominantRatio,
        effectiveSensitivity,
      );
      deviation = 0; // Categorical shifts do not have a standard deviation
    } else if (typeof value === "number") {
      const thresholds = computeThresholds(
        baseline.mean,
        baseline.stdDev,
        direction,
        effectiveSensitivity,
      );
      anomalous = isAnomalous(value, thresholds);
      deviation =
        baseline.stdDev > 0
          ? Math.abs(value - baseline.mean) / baseline.stdDev
          : 0;
    }

    const [existingAnomaly] = await db
      .select()
      .from(schema.anomalies)
      .where(
        and(
          eq(schema.anomalies.systemId, systemId),
          eq(schema.anomalies.configurationId, configurationId),
          eq(schema.anomalies.fieldPath, path),
          eq(schema.anomalies.kind, "spike"),
        ),
      )
      .limit(1);

    if (anomalous) {
      if (!existingAnomaly) {
        const [inserted] = await db
          .insert(schema.anomalies)
          .values({
            systemId,
            configurationId,
            fieldPath: path,
            kind: "spike",
            state: "suspicious",
            direction:
              typeof value === "number"
                ? value > baseline.mean
                  ? "above"
                  : "below"
                : "above",
            baselineValue: baseline.mean,
            baselineStdDev: baseline.stdDev,
            observedValue: String(value),
            deviation,
            suspiciousRunCount: 1,
            confirmationThreshold: effectiveConfirmation,
          })
          .returning({ id: schema.anomalies.id });

        // F8: Emit signal for state transition
        if (signalService && inserted) {
          await signalService.broadcast(ANOMALY_STATE_CHANGED, {
            systemId,
            anomalyId: inserted.id,
            newState: "suspicious",
          });
        }
      } else if (existingAnomaly.state === "suspicious") {
        const newCount = existingAnomaly.suspiciousRunCount + 1;
        if (newCount >= existingAnomaly.confirmationThreshold) {
          await db
            .update(schema.anomalies)
            .set({
              state: "anomaly",
              confirmedAt: new Date(),
              observedValue: String(value),
              deviation,
            })
            .where(eq(schema.anomalies.id, existingAnomaly.id));
          logger.warn(`Anomaly confirmed for ${systemId} on ${path}`);

          // F8: Emit signal for state transition
          if (signalService) {
            await signalService.broadcast(ANOMALY_STATE_CHANGED, {
              systemId,
              anomalyId: existingAnomaly.id,
              newState: "anomaly",
            });
          }

          // F1: Sidecar Notification Orchestration
          await dispatchAnomalyNotification({
            action: "confirmed",
            systemId,
            fieldPath: path,
            observedValue: value,
            baselineMean: baseline.mean,
            catalogClient,
            logger,
          });
        } else {
          await db
            .update(schema.anomalies)
            .set({
              suspiciousRunCount: newCount,
              observedValue: String(value),
              deviation,
            })
            .where(eq(schema.anomalies.id, existingAnomaly.id));
        }
      } else if (existingAnomaly.state === "anomaly") {
        await db
          .update(schema.anomalies)
          .set({
            observedValue: String(value),
            deviation,
          })
          .where(eq(schema.anomalies.id, existingAnomaly.id));
      }
    } else {
      if (existingAnomaly) {
        if (existingAnomaly.state === "suspicious") {
          await db
            .delete(schema.anomalies)
            .where(eq(schema.anomalies.id, existingAnomaly.id));
        } else if (existingAnomaly.state === "anomaly") {
          await db
            .update(schema.anomalies)
            .set({
              state: "recovered",
              recoveredAt: new Date(),
              observedValue: String(value),
            })
            .where(eq(schema.anomalies.id, existingAnomaly.id));
          logger.info(`Anomaly recovered for ${systemId} on ${path}`);

          // F8: Emit signal for state transition
          if (signalService) {
            await signalService.broadcast(ANOMALY_STATE_CHANGED, {
              systemId,
              anomalyId: existingAnomaly.id,
              newState: "recovered",
            });
          }

          // F1: Sidecar Notification Orchestration
          await dispatchAnomalyNotification({
            action: "recovered",
            systemId,
            fieldPath: path,
            observedValue: value,
            baselineMean: baseline.mean,
            catalogClient,
            logger,
          });
        }
      }
    }
  }
}
