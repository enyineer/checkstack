import type { SafeDatabase } from "@checkstack/backend-api";
import type { CacheProvider } from "@checkstack/cache-api";
import * as schema from "./schema";
import { eq, and } from "drizzle-orm";
import { computeThresholds, isAnomalous, inferAnomalyDirection, resolveEffectiveConfig, type FieldBaseline } from "@checkstack/anomaly-common";
import type { Logger } from "@checkstack/backend-api";
import type { CatalogApi } from "@checkstack/catalog-common";
import { catalogRoutes } from "@checkstack/catalog-common";
import type { InferClient } from "@checkstack/common";
import { resolveRoute } from "@checkstack/common";
import { AnomalyService } from "./service";
import type { AnomalySettings } from "@checkstack/anomaly-common";

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
}) {
  if (!result || status !== "healthy") {
    // Only analyze successful results for anomalies
    return;
  }

  const fieldsToCheck: { path: string; value: number }[] = [];
  
  // `result` here is specifically the `collectors` dictionary where keys are UUIDs
  // e.g. { "uuid-1234": { "_collectorId": "healthcheck-http.request", "responseTimeMs": 50 } }
  for (const collectorData of Object.values(result)) {
    if (typeof collectorData === "object" && collectorData !== null) {
      const data = collectorData as Record<string, unknown>;
      const realCollectorId = data._collectorId;
      
      if (typeof realCollectorId === "string") {
        for (const [fieldName, value] of Object.entries(data)) {
          if (fieldName === "_collectorId" || fieldName.startsWith("_")) continue;
          if (typeof value === "number") {
            fieldsToCheck.push({ path: `collectors.${realCollectorId}.${fieldName}`, value });
          }
        }
      }
    }
  }

  // Check each numeric field
  for (const { path, value } of fieldsToCheck) {
    const cacheKey = `baseline:${configurationId}:${systemId}:${path}`;
    let baseline = await cache.get<FieldBaseline>(cacheKey);

    if (!baseline) {
      const [dbBaseline] = await db.select()
        .from(schema.anomalyBaselines)
        .where(
          and(
            eq(schema.anomalyBaselines.systemId, systemId),
            eq(schema.anomalyBaselines.configurationId, configurationId),
            eq(schema.anomalyBaselines.fieldPath, path)
          )
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

    // Resolve configuration (Cascading Model: Assignment > Config)
    // Note: Schema resolution would go here if `resultSchema` was passed to the hook.
    let templateConfig: AnomalySettings | undefined;
    let assignmentConfig: Partial<AnomalySettings> | undefined;
    try {
      const anomalyService = new AnomalyService(db);
      const templateRecord = await anomalyService.getAnomalyConfig(configurationId);
      templateConfig = templateRecord.data;
      const assignmentRecord = await anomalyService.getAnomalyAssignmentConfig(systemId, configurationId);
      assignmentConfig = assignmentRecord?.data ?? undefined;
    } catch (error) {
      logger.warn(`Failed to fetch anomaly configuration for ${configurationId}`, error);
    }

    const {
      enabled: effectiveEnabled,
      sensitivity: effectiveSensitivity,
      confirmationWindow: effectiveConfirmation
    } = resolveEffectiveConfig(path, templateConfig, assignmentConfig);

    if (!effectiveEnabled) {
      continue;
    }

    const direction = inferAnomalyDirection("line"); // Simplified for spike
    const thresholds = computeThresholds(baseline.mean, baseline.stdDev, direction, effectiveSensitivity);
    const anomalous = isAnomalous(value, thresholds);

    const [existingAnomaly] = await db.select()
      .from(schema.anomalies)
      .where(
        and(
          eq(schema.anomalies.systemId, systemId),
          eq(schema.anomalies.configurationId, configurationId),
          eq(schema.anomalies.fieldPath, path)
        )
      )
      .limit(1);

    if (anomalous) {
      const deviation = baseline.stdDev > 0 ? Math.abs(value - baseline.mean) / baseline.stdDev : 0;
      
      if (!existingAnomaly) {
        await db.insert(schema.anomalies).values({
          systemId,
          configurationId,
          fieldPath: path,
          state: "suspicious",
          direction: value > baseline.mean ? "above" : "below",
          baselineValue: baseline.mean,
          baselineStdDev: baseline.stdDev,
          observedValue: String(value),
          deviation,
          suspiciousRunCount: 1,
          confirmationThreshold: effectiveConfirmation,
        });
      } else if (existingAnomaly.state === "suspicious") {
        const newCount = existingAnomaly.suspiciousRunCount + 1;
        if (newCount >= existingAnomaly.confirmationThreshold) {
          await db.update(schema.anomalies)
            .set({ 
              state: "anomaly", 
              confirmedAt: new Date(),
              observedValue: String(value),
              deviation,
            })
            .where(eq(schema.anomalies.id, existingAnomaly.id));
          logger.warn(`Anomaly confirmed for ${systemId} on ${path}`);
          
          const system = await catalogClient.getSystem({ systemId });
          const systemName = system?.name ?? systemId;
          const actionUrl = resolveRoute(catalogRoutes.routes.systemDetail, { systemId });
          
          catalogClient.notifySystemSubscribers({
            systemId,
            title: `Metric Anomaly Detected: ${systemName}`,
            body: `An anomaly was detected on metric **${path}** affecting **${systemName}**. Observed value: ${value} (expected ~${baseline.mean}).`,
            importance: "warning",
            action: {
              label: "View System",
              url: actionUrl,
            },
            includeGroupSubscribers: true,
          }).catch((error: unknown) => logger.warn(`Failed to dispatch anomaly notification for ${systemId}`, error));
        } else {
          await db.update(schema.anomalies)
            .set({ 
              suspiciousRunCount: newCount,
              observedValue: String(value),
              deviation,
            })
            .where(eq(schema.anomalies.id, existingAnomaly.id));
        }
      } else if (existingAnomaly.state === "anomaly") {
        await db.update(schema.anomalies)
          .set({ 
            observedValue: String(value),
            deviation,
          })
          .where(eq(schema.anomalies.id, existingAnomaly.id));
      }
    } else {
      if (existingAnomaly) {
        if (existingAnomaly.state === "suspicious") {
          await db.delete(schema.anomalies).where(eq(schema.anomalies.id, existingAnomaly.id));
        } else if (existingAnomaly.state === "anomaly") {
          await db.update(schema.anomalies)
            .set({ 
              state: "recovered", 
              recoveredAt: new Date(),
              observedValue: String(value),
            })
            .where(eq(schema.anomalies.id, existingAnomaly.id));
          logger.info(`Anomaly recovered for ${systemId} on ${path}`);
          
          const system = await catalogClient.getSystem({ systemId });
          const systemName = system?.name ?? systemId;
          const actionUrl = resolveRoute(catalogRoutes.routes.systemDetail, { systemId });
          
          catalogClient.notifySystemSubscribers({
            systemId,
            title: `Metric Anomaly Recovered: ${systemName}`,
            body: `The metric **${path}** on **${systemName}** has returned to normal expected bounds.`,
            importance: "info",
            action: {
              label: "View System",
              url: actionUrl,
            },
            includeGroupSubscribers: true,
          }).catch((error: unknown) => logger.warn(`Failed to dispatch recovery notification for ${systemId}`, error));
        }
      }
    }
  }
}
