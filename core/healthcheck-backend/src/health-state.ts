import { and, desc, eq, gte } from "drizzle-orm";
import type { HealthCheckStatus } from "@checkstack/healthcheck-common";
import type { Logger, SafeDatabase } from "@checkstack/backend-api";
import type { InferClient } from "@checkstack/common";
import { MaintenanceApi } from "@checkstack/maintenance-common";
import { healthCheckAggregates, healthCheckRuns } from "./schema";
import * as schema from "./schema";
import {
  countStateTransitionsInWindow,
  findInStatusSince,
} from "./state-transitions";

type Db = SafeDatabase<typeof schema>;
type MaintenanceClient = InferClient<typeof MaintenanceApi>;

/**
 * Live, service-typed health-state snapshot for a single system. This
 * is the data contract the automation sensing layer (Wave 2) reads to
 * answer "is this system unhealthy, and for how long?" without
 * re-deriving the math each time.
 */
export interface HealthState {
  /** Aggregate status across all enabled checks. */
  status: HealthCheckStatus;
  /**
   * When the system most recently entered `status`. Null when no
   * transition has been recorded yet (fail-safe: never throws).
   */
  inStatusSince: Date | null;
  /**
   * Milliseconds the system has continuously been in `status`. 0 when
   * `inStatusSince` is unknown.
   */
  inStatusForMs: number;
  /** Latency of the newest run, if any. */
  latencyMs?: number;
  /** Windowed average latency from recent aggregate buckets. */
  avgLatencyMs?: number;
  /** Windowed p95 latency from recent aggregate buckets. */
  p95LatencyMs?: number;
  /** Windowed success rate (healthy / total) in [0, 1] from buckets. */
  successRate?: number;
  /** Timestamp of the newest run, if any. */
  lastRunAt?: Date;
  /** Whether the system is currently in a maintenance window. */
  inMaintenance: boolean;
  /**
   * Count of aggregate status transitions in the trailing
   * `transitionWindowMinutes` window. Generalizes flapping detection -
   * an automation can gate on "N status changes in M minutes".
   */
  transitionsInWindow: number;
  /** The window (minutes) `transitionsInWindow` was counted over. */
  transitionWindowMinutes: number;
  /** When this snapshot was computed. */
  evaluatedAt: Date;
}

/** Raw inputs to the pure builder, decoupled from the DB layer. */
export interface HealthStateInputs {
  status: HealthCheckStatus;
  inStatusSince: Date | null;
  latencyMs?: number;
  avgLatencyMs?: number;
  p95LatencyMs?: number;
  successRate?: number;
  lastRunAt?: Date;
  inMaintenance: boolean;
  transitionsInWindow: number;
  transitionWindowMinutes: number;
  now: Date;
}

/** Default trailing window (minutes) for the transition count. */
export const DEFAULT_TRANSITION_WINDOW_MINUTES = 60;

/**
 * Pure assembler for a {@link HealthState}. Computes `inStatusForMs`
 * from `inStatusSince` relative to `now`, clamped at 0 so clock skew
 * never yields a negative duration. No I/O.
 */
export function buildHealthState(inputs: HealthStateInputs): HealthState {
  const {
    status,
    inStatusSince,
    latencyMs,
    avgLatencyMs,
    p95LatencyMs,
    successRate,
    lastRunAt,
    inMaintenance,
    transitionsInWindow,
    transitionWindowMinutes,
    now,
  } = inputs;

  const inStatusForMs = inStatusSince
    ? Math.max(0, now.getTime() - inStatusSince.getTime())
    : 0;

  return {
    status,
    inStatusSince,
    inStatusForMs,
    latencyMs,
    avgLatencyMs,
    p95LatencyMs,
    successRate,
    lastRunAt,
    inMaintenance,
    transitionsInWindow,
    transitionWindowMinutes,
    evaluatedAt: now,
  };
}

/**
 * Newest run (latency + timestamp) for a system, optionally narrowed to
 * a single check. Returns undefined fields when no run exists.
 */
export async function findLatestRun({
  db,
  systemId,
  configurationId,
}: {
  db: Db;
  systemId: string;
  configurationId?: string;
}): Promise<{ latencyMs?: number; lastRunAt?: Date }> {
  const conditions = [eq(healthCheckRuns.systemId, systemId)];
  if (configurationId) {
    conditions.push(eq(healthCheckRuns.configurationId, configurationId));
  }

  const [row] = await db
    .select({
      latencyMs: healthCheckRuns.latencyMs,
      timestamp: healthCheckRuns.timestamp,
    })
    .from(healthCheckRuns)
    .where(and(...conditions))
    .orderBy(desc(healthCheckRuns.timestamp))
    .limit(1);

  if (!row) return {};
  return {
    latencyMs: row.latencyMs ?? undefined,
    lastRunAt: row.timestamp,
  };
}

/** Number of hours of aggregate buckets folded into windowed metrics. */
const DEFAULT_METRICS_WINDOW_HOURS = 24;

/**
 * Windowed metrics (avg/p95 latency, success rate) computed from hourly
 * aggregate buckets over the trailing window. Returns undefined fields
 * when no buckets exist in the window.
 */
export async function computeWindowedMetrics({
  db,
  systemId,
  configurationId,
  now = new Date(),
  windowHours = DEFAULT_METRICS_WINDOW_HOURS,
}: {
  db: Db;
  systemId: string;
  configurationId?: string;
  now?: Date;
  windowHours?: number;
}): Promise<{
  avgLatencyMs?: number;
  p95LatencyMs?: number;
  successRate?: number;
}> {
  const windowStart = new Date(now.getTime() - windowHours * 3_600_000);
  const conditions = [
    eq(healthCheckAggregates.systemId, systemId),
    eq(healthCheckAggregates.bucketSize, "hourly"),
    gte(healthCheckAggregates.bucketStart, windowStart),
  ];
  if (configurationId) {
    conditions.push(
      eq(healthCheckAggregates.configurationId, configurationId),
    );
  }

  const buckets = await db
    .select({
      runCount: healthCheckAggregates.runCount,
      healthyCount: healthCheckAggregates.healthyCount,
      latencySumMs: healthCheckAggregates.latencySumMs,
      p95LatencyMs: healthCheckAggregates.p95LatencyMs,
    })
    .from(healthCheckAggregates)
    .where(and(...conditions));

  return aggregateWindowedMetrics(buckets);
}

/**
 * Pure reduction of aggregate buckets into windowed metrics. Avg
 * latency is the latency-sum-weighted mean; p95 is the max bucket p95
 * (a conservative upper bound without re-merging t-digests); success
 * rate is healthy/total across the window.
 */
export function aggregateWindowedMetrics(
  buckets: Array<{
    runCount: number;
    healthyCount: number;
    latencySumMs: number | null;
    p95LatencyMs: number | null;
  }>,
): {
  avgLatencyMs?: number;
  p95LatencyMs?: number;
  successRate?: number;
} {
  if (buckets.length === 0) return {};

  let totalRuns = 0;
  let totalHealthy = 0;
  let latencySum = 0;
  let latencyRuns = 0;
  let maxP95: number | undefined;

  for (const b of buckets) {
    totalRuns += b.runCount;
    totalHealthy += b.healthyCount;
    if (b.latencySumMs != null) {
      latencySum += b.latencySumMs;
      latencyRuns += b.runCount;
    }
    if (b.p95LatencyMs != null) {
      maxP95 = maxP95 == null ? b.p95LatencyMs : Math.max(maxP95, b.p95LatencyMs);
    }
  }

  return {
    avgLatencyMs:
      latencyRuns > 0 ? Math.round(latencySum / latencyRuns) : undefined,
    p95LatencyMs: maxP95,
    successRate: totalRuns > 0 ? totalHealthy / totalRuns : undefined,
  };
}

/**
 * Check whether a system is currently in a maintenance window
 * (suppression-agnostic). Fail-open to `false` on client error so a
 * maintenance-plugin outage never wedges health-state reads.
 */
async function resolveInMaintenance({
  maintenanceClient,
  systemId,
  logger,
}: {
  maintenanceClient: MaintenanceClient | undefined;
  systemId: string;
  logger?: Logger;
}): Promise<boolean> {
  if (!maintenanceClient) return false;
  try {
    const { active } = await maintenanceClient.hasActiveMaintenance({
      systemId,
    });
    return active;
  } catch (error) {
    logger?.warn(
      `Failed to resolve maintenance state for ${systemId}; assuming not in maintenance:`,
      error,
    );
    return false;
  }
}

/**
 * Orchestrate the full {@link HealthState} for a single system: status
 * (from the provided resolver), in-status-since (transitions table),
 * latest run, windowed metrics, and maintenance state. `now` is passed
 * explicitly so callers can keep a stable evaluation timestamp.
 */
export async function computeHealthState({
  db,
  systemId,
  configurationId,
  resolveStatus,
  maintenanceClient,
  logger,
  transitionWindowMinutes = DEFAULT_TRANSITION_WINDOW_MINUTES,
  now = new Date(),
}: {
  db: Db;
  systemId: string;
  configurationId?: string;
  /** Returns the aggregate status for the system (per-check when scoped). */
  resolveStatus: () => Promise<HealthCheckStatus>;
  maintenanceClient?: MaintenanceClient;
  logger?: Logger;
  /** Trailing window (minutes) for the transition count. */
  transitionWindowMinutes?: number;
  now?: Date;
}): Promise<HealthState> {
  const status = await resolveStatus();

  const [inStatusSince, latest, windowed, inMaintenance, transitionsInWindow] =
    await Promise.all([
      findInStatusSince({ db, systemId, status }),
      findLatestRun({ db, systemId, configurationId }),
      computeWindowedMetrics({ db, systemId, configurationId, now }),
      resolveInMaintenance({ maintenanceClient, systemId, logger }),
      countStateTransitionsInWindow({
        db,
        systemId,
        windowMinutes: transitionWindowMinutes,
        now,
      }),
    ]);

  return buildHealthState({
    status,
    inStatusSince,
    latencyMs: latest.latencyMs,
    avgLatencyMs: windowed.avgLatencyMs,
    p95LatencyMs: windowed.p95LatencyMs,
    successRate: windowed.successRate,
    lastRunAt: latest.lastRunAt,
    inMaintenance,
    transitionsInWindow,
    transitionWindowMinutes,
    now,
  });
}
