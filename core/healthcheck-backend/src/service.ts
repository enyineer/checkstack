import {
  HealthCheckConfiguration,
  CreateHealthCheckConfiguration,
  UpdateHealthCheckConfiguration,
  StateThresholds,
  HealthCheckStatus,
  RetentionConfig,
  type HealthCheckRunResult,
  type NotificationPolicy,
  NotificationPolicySchema,
  DEFAULT_NOTIFICATION_POLICY,
  type CollectorConfigEntry,
  type HealthcheckSignalStatuses,
} from "@checkstack/healthcheck-common";
import type { ConfigService } from "@checkstack/backend-api";
import type { InferClient } from "@checkstack/common";
import type { CatalogApi } from "@checkstack/catalog-common";
import {
  notificationDefaultsConfigV1,
  NOTIFICATION_DEFAULTS_CONFIG_ID,
  NOTIFICATION_DEFAULTS_CONFIG_VERSION,
} from "./notification-defaults-config";
import {
  healthCheckConfigurations,
  systemHealthChecks,
  healthCheckRuns,
  healthCheckAggregates,
  VersionedStateThresholds,
} from "./schema";
import * as schema from "./schema";
import {
  eq,
  and,
  InferSelectModel,
  desc,
  gte,
  lte,
  isNull,
  inArray,
} from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import { evaluateHealthStatus } from "./state-evaluator";
import { computeHealthState, type HealthState } from "./health-state";
import { parseHealthEntityId } from "./health-entity-id";
import { stateThresholds } from "./state-thresholds-migrations";
import type { MaintenanceApi } from "@checkstack/maintenance-common";
import type { Logger } from "@checkstack/backend-api";
import { incrementHourlyAggregate } from "./realtime-aggregation";
import type {
  HealthCheckRegistry,
  SafeDatabase,
  CollectorRegistry,
} from "@checkstack/backend-api";
import {
  aggregateCollectorData,
  extractLatencies,
  mergeTieredBuckets,
  reaggregateBuckets,
  countStatuses,
  calculateLatencyStats,
  type NormalizedBucket,
} from "./aggregation-utils";

// Drizzle type helper - uses SafeDatabase to prevent relational query API usage
type Db = SafeDatabase<typeof schema>;

/**
 * Narrow a migrated config (typed `unknown` by the versioning chain) to a
 * spreadable record. Every registered strategy/collector config schema is an
 * object, so a successfully validated value is always object-shaped at
 * runtime; this guard keeps the type-level handling cast-free.
 */
function isConfigRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// Catalog client type used to resolve human-readable system names for
// satellite assignment run-context. Optional on the service.
type CatalogClient = InferClient<typeof CatalogApi>;

// Maintenance client type used to fold suppression-agnostic maintenance
// state into the health-state snapshot. Optional on the read path.
type MaintenanceClient = InferClient<typeof MaintenanceApi>;

interface SystemCheckStatus {
  configurationId: string;
  configurationName: string;
  status: HealthCheckStatus;
  runsConsidered: number;
  lastRunAt?: Date;
}

interface SystemHealthStatusResponse {
  status: HealthCheckStatus;
  evaluatedAt: Date;
  checkStatuses: SystemCheckStatus[];
}

export class HealthCheckService {
  constructor(
    private db: Db,
    private registry: HealthCheckRegistry,
    private collectorRegistry: CollectorRegistry,
    /**
     * Optional — only required by code paths that resolve platform
     * defaults (notification policy fallback). When absent, callers
     * fall back to the compile-time `DEFAULT_NOTIFICATION_POLICY`.
     * Kept optional so existing GitOps-only / test constructions don't
     * have to plumb it through.
     */
    private configService?: ConfigService,
    /**
     * Optional — used to resolve human-readable system names when building
     * satellite assignment run-context. When absent (e.g. GitOps-only /
     * test constructions), `systemName` falls back to the `systemId`.
     */
    private catalogClient?: CatalogClient,
  ) {}

  /**
   * Resolve the platform-wide notification policy defaults. Returns
   * the compile-time defaults when no `configService` was provided or
   * nothing has ever been persisted. Stored values are passed through
   * the schema so missing fields default in.
   */
  async getPlatformNotificationDefaults(): Promise<NotificationPolicy> {
    if (!this.configService) {
      return DEFAULT_NOTIFICATION_POLICY;
    }
    const stored = await this.configService.get(
      NOTIFICATION_DEFAULTS_CONFIG_ID,
      notificationDefaultsConfigV1,
      NOTIFICATION_DEFAULTS_CONFIG_VERSION,
    );
    return stored ?? DEFAULT_NOTIFICATION_POLICY;
  }

  /**
   * Persist platform-wide notification policy defaults. Per-assignment
   * rows with `notificationPolicy = null` will read the new defaults
   * on their next evaluation. In-flight auto-incidents are unaffected
   * (their cooldown is snapshotted per-row at open time).
   */
  async setPlatformNotificationDefaults(
    policy: NotificationPolicy,
  ): Promise<void> {
    if (!this.configService) {
      throw new Error(
        "ConfigService not configured; cannot persist platform notification defaults",
      );
    }
    await this.configService.set(
      NOTIFICATION_DEFAULTS_CONFIG_ID,
      notificationDefaultsConfigV1,
      NOTIFICATION_DEFAULTS_CONFIG_VERSION,
      policy,
    );
  }

  async createConfiguration(
    data: CreateHealthCheckConfiguration,
  ): Promise<HealthCheckConfiguration> {
    const [config] = await this.db
      .insert(healthCheckConfigurations)
      .values({
        name: data.name,
        strategyId: data.strategyId,
        config: data.config,
        collectors: data.collectors ?? undefined,
        intervalSeconds: data.intervalSeconds,
        isTemplate: false, // Defaulting for now
      })
      .returning();
    return this.mapConfig(config);
  }

  async getConfiguration(
    id: string,
  ): Promise<HealthCheckConfiguration | undefined> {
    const [config] = await this.db
      .select()
      .from(healthCheckConfigurations)
      .where(eq(healthCheckConfigurations.id, id));
    return config ? this.mapConfig(config) : undefined;
  }

  async updateConfiguration(
    id: string,
    data: UpdateHealthCheckConfiguration,
  ): Promise<HealthCheckConfiguration | undefined> {
    const [config] = await this.db
      .update(healthCheckConfigurations)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(healthCheckConfigurations.id, id))
      .returning();
    return config ? this.mapConfig(config) : undefined;
  }

  async deleteConfiguration(id: string): Promise<void> {
    await this.db
      .delete(healthCheckConfigurations)
      .where(eq(healthCheckConfigurations.id, id));
  }

  async pauseConfiguration(id: string): Promise<void> {
    await this.db
      .update(healthCheckConfigurations)
      .set({ paused: true, updatedAt: new Date() })
      .where(eq(healthCheckConfigurations.id, id));
  }

  async resumeConfiguration(id: string): Promise<void> {
    await this.db
      .update(healthCheckConfigurations)
      .set({ paused: false, updatedAt: new Date() })
      .where(eq(healthCheckConfigurations.id, id));
  }

  async getConfigurations(): Promise<HealthCheckConfiguration[]> {
    const configs = await this.db.select().from(healthCheckConfigurations);
    return Promise.all(configs.map((c) => this.mapConfig(c)));
  }

  async associateSystem(props: {
    systemId: string;
    configurationId: string;
    enabled?: boolean;
    stateThresholds?: StateThresholds;
    satelliteIds?: string[];
    /**
     * Per-assignment environment selector. `null` (or `undefined`) = all
     * current environments; `[]` = opt out (env-less); non-empty = those
     * ids. `null` and `[]` are stored distinctly so the run-time resolver
     * can tell "all" from "opt out". `undefined` is normalized to `null`.
     */
    environmentIds?: string[] | null;
    includeLocal?: boolean;
    notificationPolicy?: NotificationPolicy;
  }) {
    const {
      systemId,
      configurationId,
      enabled = true,
      stateThresholds: stateThresholds_,
      satelliteIds,
      environmentIds,
      includeLocal = true,
      notificationPolicy,
    } = props;

    // Preserve the null/[]/list distinction faithfully. `undefined` props
    // mean "not provided" -> treat as `null` ("all current environments"),
    // the default fan-out behavior. `[]` is kept verbatim (opt-out).
    const environmentIdsValue: string[] | null = environmentIds ?? null;

    // Wrap thresholds in versioned config if provided
    const versionedThresholds: VersionedStateThresholds | undefined =
      stateThresholds_ ? stateThresholds.create(stateThresholds_) : undefined;

    await this.db
      .insert(systemHealthChecks)
      .values({
        systemId,
        configurationId,
        enabled,
        stateThresholds: versionedThresholds,
        satelliteIds: satelliteIds ?? undefined,
        environmentIds: environmentIdsValue,
        includeLocal,
        notificationPolicy: notificationPolicy ?? undefined,
      })
      .onConflictDoUpdate({
        target: [
          systemHealthChecks.systemId,
          systemHealthChecks.configurationId,
        ],
        set: {
          enabled,
          stateThresholds: versionedThresholds,
          satelliteIds: satelliteIds ?? undefined,
          environmentIds: environmentIdsValue,
          includeLocal,
          notificationPolicy: notificationPolicy ?? undefined,
          updatedAt: new Date(),
        },
      });
  }

  /**
   * Flip the `enabled` flag on an existing `systemHealthChecks` row
   * without touching any of the other configuration (thresholds,
   * satellite assignment, notification policy). Returns `true` when a
   * row was updated, `false` when the assignment doesn't exist.
   *
   * Carved out so the automation actions `enable_assignment` /
   * `disable_assignment` don't have to round-trip through
   * `associateSystem` (which would otherwise wipe operator-managed
   * fields when invoked with a sparse partial).
   */
  async setAssignmentEnabled(
    systemId: string,
    configurationId: string,
    enabled: boolean,
  ): Promise<boolean> {
    const result = await this.db
      .update(systemHealthChecks)
      .set({ enabled, updatedAt: new Date() })
      .where(
        and(
          eq(systemHealthChecks.systemId, systemId),
          eq(systemHealthChecks.configurationId, configurationId),
        ),
      )
      .returning({ systemId: systemHealthChecks.systemId });
    return result.length > 0;
  }

  async disassociateSystem(systemId: string, configurationId: string) {
    await this.db
      .delete(systemHealthChecks)
      .where(
        and(
          eq(systemHealthChecks.systemId, systemId),
          eq(systemHealthChecks.configurationId, configurationId),
        ),
      );
  }

  /**
   * Get retention configuration for a health check assignment.
   */
  async getRetentionConfig(
    systemId: string,
    configurationId: string,
  ): Promise<{ retentionConfig: RetentionConfig | null }> {
    const row = await this.db
      .select({ retentionConfig: systemHealthChecks.retentionConfig })
      .from(systemHealthChecks)
      .where(
        and(
          eq(systemHealthChecks.systemId, systemId),
          eq(systemHealthChecks.configurationId, configurationId),
        ),
      )
      .then((rows) => rows[0]);

     
    return { retentionConfig: row?.retentionConfig ?? null };
  }

  /**
   * Update retention configuration for a health check assignment.
   */
  async updateRetentionConfig(
    systemId: string,
    configurationId: string,
    retentionConfig: RetentionConfig | null,
  ): Promise<void> {
    // Validate retention hierarchy: raw < hourly < daily
    if (retentionConfig) {
      if (
        retentionConfig.rawRetentionDays >= retentionConfig.hourlyRetentionDays
      ) {
        throw new ORPCError("BAD_REQUEST", {
          message: "Raw retention must be less than hourly retention",
        });
      }
      if (
        retentionConfig.hourlyRetentionDays >=
        retentionConfig.dailyRetentionDays
      ) {
        throw new ORPCError("BAD_REQUEST", {
          message: "Hourly retention must be less than daily retention",
        });
      }
    }

    await this.db
      .update(systemHealthChecks)
      .set({ retentionConfig, updatedAt: new Date() })
      .where(
        and(
          eq(systemHealthChecks.systemId, systemId),
          eq(systemHealthChecks.configurationId, configurationId),
        ),
      );
  }

  /**
   * Remove all health check associations for a system.
   * Called when a system is deleted from the catalog.
   */
  async removeAllSystemAssociations(systemId: string) {
    await this.db
      .delete(systemHealthChecks)
      .where(eq(systemHealthChecks.systemId, systemId));
  }

  async getSystemConfigurations(
    systemId: string,
  ): Promise<HealthCheckConfiguration[]> {
    const rows = await this.db
      .select({
        config: healthCheckConfigurations,
      })
      .from(systemHealthChecks)
      .innerJoin(
        healthCheckConfigurations,
        eq(systemHealthChecks.configurationId, healthCheckConfigurations.id),
      )
      .where(eq(systemHealthChecks.systemId, systemId));

    return Promise.all(rows.map((r) => this.mapConfig(r.config)));
  }

  /**
   * Get system associations with their threshold configurations.
   */
  async getSystemAssociations(systemId: string) {
    const rows = await this.db
      .select({
        configurationId: systemHealthChecks.configurationId,
        configName: healthCheckConfigurations.name,
        enabled: systemHealthChecks.enabled,
        stateThresholds: systemHealthChecks.stateThresholds,
        satelliteIds: systemHealthChecks.satelliteIds,
        environmentIds: systemHealthChecks.environmentIds,
        includeLocal: systemHealthChecks.includeLocal,
        notificationPolicy: systemHealthChecks.notificationPolicy,
      })
      .from(systemHealthChecks)
      .innerJoin(
        healthCheckConfigurations,
        eq(systemHealthChecks.configurationId, healthCheckConfigurations.id),
      )
      .where(eq(systemHealthChecks.systemId, systemId));

    // Migrate and extract thresholds for each association
    const results = [];
    for (const row of rows) {
      let thresholds: StateThresholds | undefined;
      if (row.stateThresholds) {
        thresholds = await stateThresholds.parse(row.stateThresholds);
      }
      results.push({
        configurationId: row.configurationId,
        configurationName: row.configName,
        enabled: row.enabled,
        stateThresholds: thresholds,
        satelliteIds: row.satelliteIds ?? undefined,
        // Preserve the null/[]/list distinction (null = all envs, [] = opt
        // out). Do NOT collapse null to undefined via `??`.
        environmentIds: row.environmentIds,
        includeLocal: row.includeLocal,
        notificationPolicy: row.notificationPolicy ?? undefined,
      });
    }
    return results;
  }

  /**
   * Resolve the fully-defaulted notification policy for a single
   * (system, configuration) association. Resolution order:
   *
   *   1. Per-assignment override (`systemHealthChecks.notificationPolicy`)
   *      when non-null. Stored as a full policy; missing keys defaulted
   *      via zod parse.
   *   2. Platform-wide defaults via `ConfigService`.
   *   3. Compile-time `DEFAULT_NOTIFICATION_POLICY`.
   *
   * The all-or-nothing semantic is intentional: assignment rows are
   * either fully-overridden or fully-inherited from the platform.
   * Operators can revert an override by setting the row's policy to
   * `null`, which is the "Use platform defaults" action in the UI.
   */
  async getAssignmentNotificationPolicy({
    systemId,
    configurationId,
  }: {
    systemId: string;
    configurationId: string;
  }): Promise<NotificationPolicy> {
    const [row] = await this.db
      .select({
        notificationPolicy: systemHealthChecks.notificationPolicy,
      })
      .from(systemHealthChecks)
      .where(
        and(
          eq(systemHealthChecks.systemId, systemId),
          eq(systemHealthChecks.configurationId, configurationId),
        ),
      )
      .limit(1);

    // No assignment row → use platform defaults (the only sensible
    // value for a configuration nothing has explicitly touched).
    if (!row || row.notificationPolicy === null) {
      return this.getPlatformNotificationDefaults();
    }
    return NotificationPolicySchema.parse(row.notificationPolicy);
  }

  /**
   * Get the evaluated health status for a system based on configured thresholds.
   * Aggregates status from all health check configurations for this system.
   *
   * Environment dimension (Phase 3b, §7.4.2):
   *  - `environmentId` OMITTED (or `undefined`) ⇒ the **system rollup**: all
   *    runs for the system regardless of environment. "Any env unhealthy ⇒ at
   *    least one unhealthy run in the window" already yields worst-status
   *    semantics for the window-based evaluator, and it exactly matches the
   *    pre-3b behavior when no environments exist (no extra catalog read).
   *  - `environmentId` a STRING ⇒ the per-environment slice: only runs whose
   *    `environment_id` equals that id.
   *  - `environmentId` `null` ⇒ the ENV-LESS slice: only runs with
   *    `environment_id IS NULL` (the opt-out / no-membership case).
   *
   * The env filter narrows ONLY the per-check run window; the set of enabled
   * associations (and thus `checkStatuses.length`, the existence gate) is the
   * same across views, so a per-env view and the rollup agree on totalChecks.
   */
  async getSystemHealthStatus(
    systemId: string,
    environmentId?: string | null,
  ): Promise<SystemHealthStatusResponse> {
    // Get all associations for this system with their thresholds and config names
    const associations = await this.db
      .select({
        configurationId: systemHealthChecks.configurationId,
        stateThresholds: systemHealthChecks.stateThresholds,
        configName: healthCheckConfigurations.name,
        enabled: systemHealthChecks.enabled,
      })
      .from(systemHealthChecks)
      .innerJoin(
        healthCheckConfigurations,
        eq(systemHealthChecks.configurationId, healthCheckConfigurations.id),
      )
      .where(
        and(
          eq(systemHealthChecks.systemId, systemId),
          eq(systemHealthChecks.enabled, true),
        ),
      );

    if (associations.length === 0) {
      // No health checks configured - default healthy
      return {
        status: "healthy",
        evaluatedAt: new Date(),
        checkStatuses: [],
      };
    }

    // For each association, get recent runs and evaluate status
    const checkStatuses: SystemCheckStatus[] = [];
    const maxWindowSize = 100; // Max configurable window size

    // Environment filter for the per-check run window. `undefined` (rollup)
    // adds no predicate; `null` filters to the env-less slice; a string
    // filters to that environment. The lookup index leads with
    // (system_id, environment_id, …) so the env-scoped query is index-efficient.
    const envFilter =
      environmentId === undefined
        ? undefined
        : environmentId === null
          ? isNull(healthCheckRuns.environmentId)
          : eq(healthCheckRuns.environmentId, environmentId);

    for (const assoc of associations) {
      const runs = await this.db
        .select({
          status: healthCheckRuns.status,
          timestamp: healthCheckRuns.timestamp,
        })
        .from(healthCheckRuns)
        .where(
          and(
            eq(healthCheckRuns.systemId, systemId),
            eq(healthCheckRuns.configurationId, assoc.configurationId),
            ...(envFilter ? [envFilter] : []),
          ),
        )
        .orderBy(desc(healthCheckRuns.timestamp))
        .limit(maxWindowSize);

      // Extract and migrate thresholds from versioned config
      let thresholds: StateThresholds | undefined;
      if (assoc.stateThresholds) {
        thresholds = await stateThresholds.parse(assoc.stateThresholds);
      }

      const status = evaluateHealthStatus({ runs, thresholds });

      checkStatuses.push({
        configurationId: assoc.configurationId,
        configurationName: assoc.configName,
        status,
        runsConsidered: runs.length,
        lastRunAt: runs[0]?.timestamp,
      });
    }

    // Aggregate status: worst status wins (unhealthy > degraded > healthy)
    let aggregateStatus: HealthCheckStatus = "healthy";
    for (const cs of checkStatuses) {
      if (cs.status === "unhealthy") {
        aggregateStatus = "unhealthy";
        break; // Can't get worse
      }
      if (cs.status === "degraded") {
        aggregateStatus = "degraded";
        // Don't break - keep looking for unhealthy
      }
    }

    return {
      status: aggregateStatus,
      evaluatedAt: new Date(),
      checkStatuses,
    };
  }

  /**
   * Global problem scan across EVERY system that has at least one enabled
   * health-check association. Returns the evaluated status keyed by systemId,
   * containing ONLY systems that are currently degraded or unhealthy (healthy
   * systems are omitted). This is the read source for the AI system-signals
   * contributor: it must answer the same on every pod, so it derives entirely
   * from the durable `health_check_runs` / `system_health_checks` tables via
   * the same per-system evaluator the dashboard uses - no per-caller systemId
   * list and no process-local state.
   */
  async getAllUnhealthySystemStatuses(): Promise<HealthcheckSignalStatuses> {
    // Distinct systemIds that have at least one ENABLED check association.
    // `getSystemHealthStatus` already short-circuits to healthy for systems
    // with no enabled associations, so this is the complete candidate set.
    const rows = await this.db
      .selectDistinct({ systemId: systemHealthChecks.systemId })
      .from(systemHealthChecks)
      .where(eq(systemHealthChecks.enabled, true));

    const result: HealthcheckSignalStatuses = {};
    await Promise.all(
      rows.map(async ({ systemId }) => {
        const status = await this.getSystemHealthStatus(systemId);
        if (status.status === "healthy") return; // problems only
        result[systemId] = status;
      }),
    );
    return result;
  }

  /**
   * Live health-state snapshot for a single system (Wave-2 sensing
   * contract). When `configurationId` is given, status reflects that
   * one check; otherwise it is the aggregate. `inStatusSince` /
   * `inStatusForMs` come from the state-transitions table, latency from
   * the newest run, windowed metrics from hourly aggregates, and
   * `inMaintenance` from the maintenance plugin (suppression-agnostic,
   * fail-open). `now` is threaded so bulk reads share one timestamp.
   */
  async getHealthState({
    systemId,
    configurationId,
    environmentId,
    maintenanceClient,
    logger,
    transitionWindowMinutes,
    now,
  }: {
    systemId: string;
    configurationId?: string;
    /**
     * Environment to scope the snapshot to (Phase 3b). `undefined` = the
     * system rollup; `null` = the env-less slice; a string = that env. Threads
     * into both the status resolver and every durable read in
     * `computeHealthState`.
     */
    environmentId?: string | null;
    maintenanceClient?: MaintenanceClient;
    logger?: Logger;
    transitionWindowMinutes?: number;
    now?: Date;
  }): Promise<HealthState> {
    return computeHealthState({
      db: this.db,
      systemId,
      configurationId,
      environmentId,
      maintenanceClient,
      logger,
      transitionWindowMinutes,
      now,
      resolveStatus: async () => {
        const overview = await this.getSystemHealthStatus(
          systemId,
          environmentId,
        );
        if (!configurationId) return overview.status;
        const check = overview.checkStatuses.find(
          (c) => c.configurationId === configurationId,
        );
        // Unknown check id -> treat as healthy (no signal), mirroring
        // the "no checks configured" default.
        return check?.status ?? "healthy";
      },
    });
  }

  /**
   * Bulk variant of {@link getHealthState}. Resolves every id in parallel
   * against a single shared `now` so durations are consistent across the
   * batch. Avoids N+1 from dashboards and multi-system automation rules.
   *
   * Environment-aware (Phase 3b, §7.4.4): an id may be the bare `"<systemId>"`
   * (the system rollup) OR the env-qualified `"<systemId>::<environmentId>"`
   * (a per-environment view). Each id is parsed via {@link parseHealthEntityId}
   * and resolved against the right env slice, and the result is keyed by the
   * ORIGINAL id string. So scope enrichment that reads
   * `health.systems["<systemId>::<environmentId>"]` gets the per-env snapshot
   * and `health.systems["<systemId>"]` gets the rollup, with no caller change.
   */
  async getBulkHealthState({
    systemIds,
    maintenanceClient,
    logger,
    transitionWindowMinutes,
    now = new Date(),
  }: {
    /** Health entity ids — bare systemId (rollup) or `systemId::environmentId`. */
    systemIds: string[];
    maintenanceClient?: MaintenanceClient;
    logger?: Logger;
    transitionWindowMinutes?: number;
    now?: Date;
  }): Promise<Record<string, HealthState>> {
    const entries = await Promise.all(
      systemIds.map(async (id) => {
        const { systemId, environmentId } = parseHealthEntityId(id);
        return [
          id,
          await this.getHealthState({
            systemId,
            // A bare `<systemId>` id is the ROLLUP and must read ALL runs
            // (`undefined`), NOT the env-less slice (`null`, i.e.
            // `env_id IS NULL`). `parseHealthEntityId` returns `null` for a
            // bare id; map it to `undefined` here. `null` stays reserved for
            // an explicit env-less read.
            environmentId: environmentId === null ? undefined : environmentId,
            maintenanceClient,
            logger,
            transitionWindowMinutes,
            now,
          }),
        ] as const;
      }),
    );
    return Object.fromEntries(entries);
  }

  /**
   * Get comprehensive health overview for a system.
   * Returns all health checks with their last 25 runs for sparkline visualization.
   */
  async getSystemHealthOverview(systemId: string) {
    // Get all associations with config details
    const associations = await this.db
      .select({
        configurationId: systemHealthChecks.configurationId,
        configName: healthCheckConfigurations.name,
        strategyId: healthCheckConfigurations.strategyId,
        intervalSeconds: healthCheckConfigurations.intervalSeconds,
        enabled: systemHealthChecks.enabled,
        stateThresholds: systemHealthChecks.stateThresholds,
      })
      .from(systemHealthChecks)
      .innerJoin(
        healthCheckConfigurations,
        eq(systemHealthChecks.configurationId, healthCheckConfigurations.id),
      )
      .where(eq(systemHealthChecks.systemId, systemId));

    const checks = [];
    const sparklineLimit = 25;

    for (const assoc of associations) {
      // Get last 25 runs for sparkline (newest first, then reverse for chronological display)
      const runs = await this.db
        .select({
          id: healthCheckRuns.id,
          status: healthCheckRuns.status,
          timestamp: healthCheckRuns.timestamp,
        })
        .from(healthCheckRuns)
        .where(
          and(
            eq(healthCheckRuns.systemId, systemId),
            eq(healthCheckRuns.configurationId, assoc.configurationId),
          ),
        )
        .orderBy(desc(healthCheckRuns.timestamp))
        .limit(sparklineLimit);

      // Reverse to chronological order (oldest first) for sparkline display
      const chronologicalRuns = runs.toReversed();

      // Migrate and extract thresholds
      let thresholds: StateThresholds | undefined;
      if (assoc.stateThresholds) {
        thresholds = await stateThresholds.parse(assoc.stateThresholds);
      }

      // Evaluate current status (runs are in DESC order - newest first - as evaluateHealthStatus expects)
      const status = evaluateHealthStatus({
        runs,
        thresholds,
      });

      checks.push({
        configurationId: assoc.configurationId,
        configurationName: assoc.configName,
        strategyId: assoc.strategyId,
        intervalSeconds: assoc.intervalSeconds,
        enabled: assoc.enabled,
        status,
        stateThresholds: thresholds,
        recentRuns: chronologicalRuns.map((r) => ({
          id: r.id,
          status: r.status,
          timestamp: r.timestamp,
        })),
      });
    }

    return { systemId, checks };
  }

  /**
   * Get paginated health check run history (public - no result data).
   * @param sortOrder - 'asc' for chronological (oldest first), 'desc' for reverse (newest first)
   */
  async getHistory(props: {
    systemId?: string;
    configurationId?: string;
    startDate?: Date;
    endDate?: Date;
    sourceFilter?: string;
    statusFilter?: HealthCheckStatus[];
    limit?: number;
    offset?: number;
    sortOrder: "asc" | "desc";
  }) {
    const {
      systemId,
      configurationId,
      startDate,
      endDate,
      sourceFilter,
      statusFilter,
      limit = 10,
      offset = 0,
      sortOrder,
    } = props;

    const conditions = [];
    if (systemId) conditions.push(eq(healthCheckRuns.systemId, systemId));
    if (configurationId)
      conditions.push(eq(healthCheckRuns.configurationId, configurationId));
    if (startDate) conditions.push(gte(healthCheckRuns.timestamp, startDate));
    if (endDate) conditions.push(lte(healthCheckRuns.timestamp, endDate));

    // Source filtering: "local" = no sourceId, UUID = specific satellite
    if (sourceFilter === "local") {
      conditions.push(isNull(healthCheckRuns.sourceId));
    } else if (sourceFilter) {
      conditions.push(eq(healthCheckRuns.sourceId, sourceFilter));
    }

    // Status filtering (e.g. only failing runs)
    if (statusFilter && statusFilter.length > 0) {
      conditions.push(inArray(healthCheckRuns.status, statusFilter));
    }

    // Build where clause
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Get total count using drizzle $count
    const total = await this.db.$count(healthCheckRuns, whereClause);

    // Get paginated runs with requested sort order
    let query = this.db.select().from(healthCheckRuns);
    if (whereClause) {
      // @ts-expect-error drizzle-orm type mismatch
      query = query.where(whereClause);
    }
    const orderColumn =
      sortOrder === "desc"
        ? desc(healthCheckRuns.timestamp)
        : healthCheckRuns.timestamp;
    const runs = await query.orderBy(orderColumn).limit(limit).offset(offset);

    // Return without result field for public access (latencyMs is public data)
    return {
      runs: runs.map((run) => ({
        id: run.id,
        configurationId: run.configurationId,
        systemId: run.systemId,
        status: run.status,
        timestamp: run.timestamp,
        latencyMs: run.latencyMs ?? undefined,
        environmentId: run.environmentId ?? undefined,
        sourceId: run.sourceId ?? undefined,
        sourceLabel: run.sourceLabel ?? undefined,
      })),
      total,
    };
  }

  /**
   * Get detailed health check run history with full result data.
   * Restricted to users with manage access.
   * @param sortOrder - 'asc' for chronological (oldest first), 'desc' for reverse (newest first)
   */
  async getDetailedHistory(props: {
    systemId?: string;
    configurationId?: string;
    startDate?: Date;
    endDate?: Date;
    sourceFilter?: string;
    statusFilter?: HealthCheckStatus[];
    limit?: number;
    offset?: number;
    sortOrder: "asc" | "desc";
  }) {
    const {
      systemId,
      configurationId,
      startDate,
      endDate,
      sourceFilter,
      statusFilter,
      limit = 10,
      offset = 0,
      sortOrder,
    } = props;

    const conditions = [];
    if (systemId) conditions.push(eq(healthCheckRuns.systemId, systemId));
    if (configurationId)
      conditions.push(eq(healthCheckRuns.configurationId, configurationId));
    if (startDate) conditions.push(gte(healthCheckRuns.timestamp, startDate));
    if (endDate) conditions.push(lte(healthCheckRuns.timestamp, endDate));

    // Source filtering: "local" = no sourceId, UUID = specific satellite
    if (sourceFilter === "local") {
      conditions.push(isNull(healthCheckRuns.sourceId));
    } else if (sourceFilter) {
      conditions.push(eq(healthCheckRuns.sourceId, sourceFilter));
    }

    // Status filtering (e.g. only failing runs)
    if (statusFilter && statusFilter.length > 0) {
      conditions.push(inArray(healthCheckRuns.status, statusFilter));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const total = await this.db.$count(healthCheckRuns, whereClause);

    let query = this.db.select().from(healthCheckRuns);
    if (whereClause) {
      // @ts-expect-error drizzle-orm type mismatch
      query = query.where(whereClause);
    }
    const orderColumn =
      sortOrder === "desc"
        ? desc(healthCheckRuns.timestamp)
        : healthCheckRuns.timestamp;
    const runs = await query.orderBy(orderColumn).limit(limit).offset(offset);

    // Return with full result data for manage access
    return {
      runs: runs.map((run) => ({
        id: run.id,
        configurationId: run.configurationId,
        systemId: run.systemId,
        status: run.status,
        result: run.result ?? {},
        timestamp: run.timestamp,
        latencyMs: run.latencyMs ?? undefined,
        environmentId: run.environmentId ?? undefined,
        sourceId: run.sourceId ?? undefined,
        sourceLabel: run.sourceLabel ?? undefined,
      })),
      total,
    };
  }

  /**
   * Get a single health check run by its ID.
   */
  async getRunById(props: { runId: string }) {
    const run = await this.db
      .select()
      .from(healthCheckRuns)
      .where(eq(healthCheckRuns.id, props.runId))
      .limit(1);

    if (run.length === 0) {
      return;
    }

    const r = run[0];
    return {
      id: r.id,
      configurationId: r.configurationId,
      systemId: r.systemId,
      status: r.status,
      result: r.result ?? {},
      timestamp: r.timestamp,
      latencyMs: r.latencyMs ?? undefined,
      environmentId: r.environmentId ?? undefined,
      sourceId: r.sourceId ?? undefined,
      sourceLabel: r.sourceLabel ?? undefined,
    };
  }

  /**
   * Get aggregated health check history with dynamically-sized buckets.
   * Queries all three tiers (raw, hourly, daily) and merges with priority.
   * Bucket interval is calculated as (endDate - startDate) / targetPoints.
   */
  async getAggregatedHistory(
    props: {
      systemId: string;
      configurationId: string;
      startDate: Date;
      endDate: Date;
      sourceFilter?: string;
      targetPoints?: number;
    },
    options: { includeAggregatedResult: boolean },
  ) {
    const {
      systemId,
      configurationId,
      startDate,
      endDate,
      sourceFilter,
      targetPoints = 500,
    } = props;

    // Calculate dynamic bucket interval
    const rangeMs = endDate.getTime() - startDate.getTime();
    const MIN_INTERVAL_MS = 1000; // 1 second minimum
    const bucketIntervalMs = Math.max(rangeMs / targetPoints, MIN_INTERVAL_MS);
    const bucketIntervalSeconds = Math.round(bucketIntervalMs / 1000);

    // Get the configuration to find the strategy
    const [config] = await this.db
      .select()
      .from(healthCheckConfigurations)
      .where(eq(healthCheckConfigurations.id, configurationId))
      .limit(1);

    // Look up strategy for mergeResult function (only if needed)
    const strategy =
      options.includeAggregatedResult && config && this.registry
        ? this.registry.getStrategy(config.strategyId)
        : undefined;

    // Build source condition for raw runs
    const rawConditions = [
      eq(healthCheckRuns.systemId, systemId),
      eq(healthCheckRuns.configurationId, configurationId),
      gte(healthCheckRuns.timestamp, startDate),
      lte(healthCheckRuns.timestamp, endDate),
      ...(sourceFilter === "local"
        ? [isNull(healthCheckRuns.sourceId)]
        : sourceFilter
          ? [eq(healthCheckRuns.sourceId, sourceFilter)]
          : []),
    ];

    // Build source condition for hourly aggregates
    const hourlyConditions = [
      eq(healthCheckAggregates.systemId, systemId),
      eq(healthCheckAggregates.configurationId, configurationId),
      eq(healthCheckAggregates.bucketSize, "hourly"),
      gte(healthCheckAggregates.bucketStart, startDate),
      lte(healthCheckAggregates.bucketStart, endDate),
      ...(sourceFilter === "local"
        ? [isNull(healthCheckAggregates.sourceId)]
        : sourceFilter
          ? [eq(healthCheckAggregates.sourceId, sourceFilter)]
          : []),
    ];

    // Build source condition for daily aggregates
    const dailyConditions = [
      eq(healthCheckAggregates.systemId, systemId),
      eq(healthCheckAggregates.configurationId, configurationId),
      eq(healthCheckAggregates.bucketSize, "daily"),
      gte(healthCheckAggregates.bucketStart, startDate),
      lte(healthCheckAggregates.bucketStart, endDate),
      ...(sourceFilter === "local"
        ? [isNull(healthCheckAggregates.sourceId)]
        : sourceFilter
          ? [eq(healthCheckAggregates.sourceId, sourceFilter)]
          : []),
    ];

    // Query all three tiers in parallel
    const [rawRuns, hourlyAggregates, dailyAggregates] = await Promise.all([
      // Raw runs
      this.db
        .select()
        .from(healthCheckRuns)
        .where(and(...rawConditions))
        .orderBy(healthCheckRuns.timestamp),
      // Hourly aggregates
      this.db
        .select()
        .from(healthCheckAggregates)
        .where(and(...hourlyConditions))
        .orderBy(healthCheckAggregates.bucketStart),
      // Daily aggregates
      this.db
        .select()
        .from(healthCheckAggregates)
        .where(and(...dailyConditions))
        .orderBy(healthCheckAggregates.bucketStart),
    ]);

    // Normalize raw runs to buckets using target interval for proper aggregation
    // This ensures aggregatedResult is computed per target bucket, not per sub-bucket
    const rawBuckets = this.normalizeRawRunsToBuckets({
      runs: rawRuns,
      bucketIntervalMs: bucketIntervalMs,
      rangeStart: startDate,
      strategy,
    });

    // Normalize hourly and daily aggregates to NormalizedBucket format
    const HOURLY_MS = 60 * 60 * 1000;
    const DAILY_MS = 24 * 60 * 60 * 1000;

    const hourlyBuckets: NormalizedBucket[] = hourlyAggregates.map((agg) => ({
      bucketStart: agg.bucketStart,
      bucketEndMs: agg.bucketStart.getTime() + HOURLY_MS,
      runCount: agg.runCount,
      healthyCount: agg.healthyCount,
      degradedCount: agg.degradedCount,
      unhealthyCount: agg.unhealthyCount,
      latencySumMs: agg.latencySumMs ?? undefined,
      minLatencyMs: agg.minLatencyMs ?? undefined,
      maxLatencyMs: agg.maxLatencyMs ?? undefined,
      p95LatencyMs: agg.p95LatencyMs ?? undefined,
      aggregatedResult: agg.aggregatedResult ?? undefined,
      sourceTier: "hourly" as const,
    }));

    const dailyBuckets: NormalizedBucket[] = dailyAggregates.map((agg) => ({
      bucketStart: agg.bucketStart,
      bucketEndMs: agg.bucketStart.getTime() + DAILY_MS,
      runCount: agg.runCount,
      healthyCount: agg.healthyCount,
      degradedCount: agg.degradedCount,
      unhealthyCount: agg.unhealthyCount,
      latencySumMs: agg.latencySumMs ?? undefined,
      minLatencyMs: agg.minLatencyMs ?? undefined,
      maxLatencyMs: agg.maxLatencyMs ?? undefined,
      p95LatencyMs: agg.p95LatencyMs ?? undefined,
      aggregatedResult: agg.aggregatedResult ?? undefined,
      sourceTier: "daily" as const,
    }));

    // Merge all tiers with priority (raw > hourly > daily)
    const mergedBuckets = mergeTieredBuckets({
      rawBuckets,
      hourlyBuckets,
      dailyBuckets,
    });

    // Re-aggregate to target bucket interval with automatic strategy and collector merging
    const targetBuckets = config
      ? reaggregateBuckets({
          sourceBuckets: mergedBuckets,
          targetIntervalMs: bucketIntervalMs,
          rangeStart: startDate,
          rangeEnd: endDate,
          collectorRegistry: this.collectorRegistry,
          registry: this.registry,
          strategyId: config.strategyId,
        })
      : mergedBuckets;

    // Convert to output format
    const buckets = targetBuckets.map((bucket) => {
      const successRate =
        bucket.runCount > 0 ? bucket.healthyCount / bucket.runCount : 0;
      const avgLatencyMs =
        bucket.latencySumMs !== undefined && bucket.runCount > 0
          ? Math.round(bucket.latencySumMs / bucket.runCount)
          : undefined;

      const baseBucket = {
        bucketStart: bucket.bucketStart,
        bucketEnd: new Date(bucket.bucketEndMs),
        bucketIntervalSeconds,
        runCount: bucket.runCount,
        healthyCount: bucket.healthyCount,
        degradedCount: bucket.degradedCount,
        unhealthyCount: bucket.unhealthyCount,
        successRate,
        avgLatencyMs,
        minLatencyMs: bucket.minLatencyMs,
        maxLatencyMs: bucket.maxLatencyMs,
        p95LatencyMs: bucket.p95LatencyMs,
      };

      // Include aggregatedResult if available (only from raw data)
      if (options.includeAggregatedResult && bucket.aggregatedResult) {
        return {
          ...baseBucket,
          aggregatedResult: bucket.aggregatedResult,
        };
      }

      return baseBucket;
    });

    return { buckets, bucketIntervalSeconds };
  }

  /**
   * Normalize raw runs into buckets for merging with aggregate tiers.
   */
  private normalizeRawRunsToBuckets(params: {
    runs: Array<{
      id: string;
      status: "healthy" | "unhealthy" | "degraded";
      timestamp: Date;
      latencyMs: number | null;
      result: Record<string, unknown> | null;
    }>;
    bucketIntervalMs: number;
    rangeStart: Date;
    strategy?: {
      mergeResult: (
        existing: Record<string, unknown> | undefined,
        newRun: {
          status: "healthy" | "unhealthy" | "degraded";
          latencyMs?: number;
          metadata?: unknown;
        },
      ) => unknown;
    };
  }): NormalizedBucket[] {
    const { runs, bucketIntervalMs, rangeStart, strategy } = params;

    if (runs.length === 0) {
      return [];
    }

    // Group runs by bucket
    const bucketMap = new Map<
      string,
      {
        bucketStart: Date;
        runs: Array<{
          status: "healthy" | "unhealthy" | "degraded";
          latencyMs: number | undefined;
          metadata?: Record<string, unknown>;
        }>;
      }
    >();

    for (const run of runs) {
      const bucketStart = this.getBucketStartDynamic(
        run.timestamp,
        rangeStart,
        bucketIntervalMs,
      );
      const key = bucketStart.toISOString();

      if (!bucketMap.has(key)) {
        bucketMap.set(key, { bucketStart, runs: [] });
      }

      const storedResult = run.result as {
        metadata?: Record<string, unknown>;
      } | null;

      bucketMap.get(key)!.runs.push({
        status: run.status,
        latencyMs: run.latencyMs ?? undefined,
        metadata: storedResult?.metadata ?? undefined,
      });
    }

    // Convert to NormalizedBucket format
    const result: NormalizedBucket[] = [];

    for (const [, bucket] of bucketMap) {
      const { healthyCount, degradedCount, unhealthyCount } = countStatuses(
        bucket.runs,
      );
      const latencies = extractLatencies(bucket.runs);
      const latencyStats = calculateLatencyStats(latencies);

      // Compute aggregatedResult if strategy is available (using incremental mergeResult)
      let aggregatedResult: Record<string, unknown> | undefined;
      if (strategy) {
        // Incrementally merge each run's result
        let strategyResult: Record<string, unknown> | undefined;
        for (const run of bucket.runs) {
          strategyResult = strategy.mergeResult(strategyResult, run) as Record<
            string,
            unknown
          >;
        }

        // Aggregate collector data if collector registry is available
        let collectorsAggregated: Record<string, unknown> | undefined;
        if (this.collectorRegistry) {
          collectorsAggregated = aggregateCollectorData(
            bucket.runs,
            this.collectorRegistry,
          );
        }

        aggregatedResult = {
          ...strategyResult,
          ...(collectorsAggregated ? { collectors: collectorsAggregated } : {}),
        };
      }

      result.push({
        bucketStart: bucket.bucketStart,
        bucketEndMs: bucket.bucketStart.getTime() + bucketIntervalMs,
        runCount: bucket.runs.length,
        healthyCount,
        degradedCount,
        unhealthyCount,
        latencySumMs: latencyStats.latencySumMs,
        minLatencyMs: latencyStats.minLatencyMs,
        maxLatencyMs: latencyStats.maxLatencyMs,
        p95LatencyMs: latencyStats.p95LatencyMs,
        aggregatedResult,
        sourceTier: "raw",
      });
    }

    return result;
  }

  /**
   * Calculate bucket start time for dynamic interval sizing.
   * Aligns buckets to the query start time.
   */

  private getBucketStartDynamic(
    timestamp: Date,
    rangeStart: Date,
    intervalMs: number,
  ): Date {
    const offsetMs = timestamp.getTime() - rangeStart.getTime();
    const bucketIndex = Math.floor(offsetMs / intervalMs);
    return new Date(rangeStart.getTime() + bucketIndex * intervalMs);
  }

  /**
   * Map a stored configuration row to the public DTO, migrating the
   * (UNVERSIONED) strategy + collector configs via assume-v1-on-read so the
   * read API (router / frontend / gitops `getConfiguration`) returns migrated
   * shapes. Migrations are idempotent, so an already-current config is a
   * no-op. An unregistered strategy/collector or a failed migrate falls back
   * to the raw stored blob rather than dropping the configuration.
   */
  private async mapConfig(
    row: InferSelectModel<typeof healthCheckConfigurations>,
  ): Promise<HealthCheckConfiguration> {
    return {
      id: row.id,
      name: row.name,
      strategyId: row.strategyId,
      config: await this.migrateStrategyConfig(row.strategyId, row.config),
      collectors: await this.migrateCollectorEntries(row.collectors),
      intervalSeconds: row.intervalSeconds,
      paused: row.paused,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  /**
   * Migrate a stored strategy config via assume-v1-on-read. Falls back to the
   * raw blob when the strategy is not registered or the migrate/validate
   * throws, so a read never drops a configuration on a transient mismatch.
   */
  private async migrateStrategyConfig(
    strategyId: string,
    rawConfig: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const strategy = this.registry?.getStrategy(strategyId);
    if (!strategy) return rawConfig;
    try {
      const migrated = await strategy.config.parseAssumingV1(rawConfig);
      return { ...migrated };
    } catch {
      return rawConfig;
    }
  }

  /**
   * Migrate each collector entry's stored config via assume-v1-on-read,
   * preserving id/collectorId/assertions. Falls back to the raw entry config
   * when the collector is not registered or migrate/validate throws.
   */
  private async migrateCollectorEntries(
    collectors: CollectorConfigEntry[] | null,
  ): Promise<CollectorConfigEntry[] | undefined> {
    if (!collectors || collectors.length === 0) return undefined;
    return Promise.all(
      collectors.map(async (entry) => {
        const registered = this.collectorRegistry?.getCollector(
          entry.collectorId,
        );
        if (!registered) return entry;
        try {
          const migrated = await registered.collector.config.parseAssumingV1(
            entry.config,
          );
          // A registered collector's config schema is always an object, so a
          // successful migrate yields a record; fall back to the raw entry if
          // the validated value is somehow not object-shaped.
          if (!isConfigRecord(migrated)) return entry;
          return { ...entry, config: { ...migrated } };
        } catch {
          return entry;
        }
      }),
    );
  }

  /**
   * Remove a satellite ID from all systemHealthChecks.satelliteIds arrays.
   * Called when a satellite is deleted via the satellite.removed hook.
   */
  async scrubSatelliteFromAssociations(satelliteId: string): Promise<void> {
    // Get all associations that reference this satellite
    const associations = await this.db
      .select({
        systemId: systemHealthChecks.systemId,
        configurationId: systemHealthChecks.configurationId,
        satelliteIds: systemHealthChecks.satelliteIds,
      })
      .from(systemHealthChecks);

    // Update each association that contains this satellite ID
    for (const assoc of associations) {
      if (!assoc.satelliteIds?.includes(satelliteId)) continue;

      const updated = assoc.satelliteIds.filter((id) => id !== satelliteId);
      await this.db
        .update(systemHealthChecks)
        .set({
          satelliteIds: updated.length > 0 ? updated : undefined,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(systemHealthChecks.systemId, assoc.systemId),
            eq(systemHealthChecks.configurationId, assoc.configurationId),
          ),
        );
    }
  }

  /**
   * Get all health check assignments for a specific satellite.
   * Returns the full configuration payload needed for the satellite to execute checks.
   */
  async getAssignmentsForSatellite(satelliteId: string) {
    // Get all associations that reference this satellite
    const associations = await this.db
      .select({
        systemId: systemHealthChecks.systemId,
        configurationId: systemHealthChecks.configurationId,
        satelliteIds: systemHealthChecks.satelliteIds,
        enabled: systemHealthChecks.enabled,
      })
      .from(systemHealthChecks);

    // Filter to associations that include this satellite and are enabled
    const matchingAssociations = associations.filter(
      (a) => a.enabled && a.satelliteIds?.includes(satelliteId),
    );

    if (matchingAssociations.length === 0) return [];

    // Resolve human-readable system names once per distinct systemId.
    // Falls back to the systemId when no catalog client is wired or the
    // lookup fails, mirroring the queue-executor's resolution behaviour.
    const systemNameCache = new Map<string, string>();
    const resolveSystemName = async (systemId: string): Promise<string> => {
      const cached = systemNameCache.get(systemId);
      if (cached !== undefined) return cached;

      let systemName = systemId;
      if (this.catalogClient) {
        try {
          const system = await this.catalogClient.getSystem({ systemId });
          if (system) systemName = system.name;
        } catch {
          // Fall back to systemId if catalog lookup fails.
        }
      }
      systemNameCache.set(systemId, systemName);
      return systemName;
    };

    // Get configurations for each matching association
    const assignments = [];
    for (const assoc of matchingAssociations) {
      const [config] = await this.db
        .select()
        .from(healthCheckConfigurations)
        .where(eq(healthCheckConfigurations.id, assoc.configurationId));

      if (!config || config.paused) continue;

      assignments.push({
        configId: config.id,
        systemId: assoc.systemId,
        strategyId: config.strategyId,
        config: config.config,
        collectors: config.collectors ?? undefined,
        intervalSeconds: config.intervalSeconds,
        // Curated run-context metadata exposed to satellite collectors.
        configName: config.name,
        systemName: await resolveSystemName(assoc.systemId),
      });
    }

    return assignments;
  }

  async getRunsForAnalysis(props: {
    startDate: Date;
    limitPerAssignment?: number;
  }) {
    const { startDate, limitPerAssignment = 200 } = props;

    // Fetch all active associations
    const activeAssignments = await this.db
      .select({
        systemId: systemHealthChecks.systemId,
        configurationId: systemHealthChecks.configurationId,
      })
      .from(systemHealthChecks)
      .where(eq(systemHealthChecks.enabled, true));

    const results = [];

    // For each assignment, fetch the recent runs
    // This endpoint is used specifically for cross-plugin background jobs
    for (const assignment of activeAssignments) {
      const runs = await this.db
        .select({
          result: healthCheckRuns.result,
        })
        .from(healthCheckRuns)
        .where(
          and(
            eq(healthCheckRuns.systemId, assignment.systemId),
            eq(healthCheckRuns.configurationId, assignment.configurationId),
            gte(healthCheckRuns.timestamp, startDate),
          ),
        )
        .orderBy(desc(healthCheckRuns.timestamp))
        .limit(limitPerAssignment);

      results.push({
        systemId: assignment.systemId,
        configurationId: assignment.configurationId,
        runs: runs.map((r) => ({
          result: r.result,
        })),
      });
    }

    return results;
  }

  /**
   * Ingest a health check result from a satellite.
   * Stores the run with source attribution (sourceId + sourceLabel)
   * and triggers incremental aggregation to keep charts/availability current.
   */
  async ingestSatelliteResult(props: {
    configId: string;
    systemId: string;
    status: HealthCheckStatus;
    latencyMs?: number;
    result?: HealthCheckRunResult;
    executedAt: string;
    sourceId: string;
    sourceLabel: string;
  }) {
    const {
      configId,
      systemId,
      status,
      latencyMs,
      result,
      sourceId,
      sourceLabel,
    } = props;

    const resultRecord = result
      ? ({ ...result } as Record<string, unknown>)
      : {};

    // Atomic: the run row and the hourly-aggregate increment it feeds must
    // commit together. Without the transaction a failure on the (non-idempotent
    // `runCount + 1`) aggregate left a committed run that the aggregate never
    // counted - or, on the reverse ordering, an aggregate with no backing run.
    // NOTE: this guarantees run/aggregate consistency, but does NOT make a
    // *duplicate satellite delivery* (a re-POST after a committed write)
    // idempotent - that requires a dedupe key on the high-volume runs table and
    // is tracked as a separate follow-up.
    await this.db.transaction(async (tx) => {
      await tx.insert(healthCheckRuns).values({
        configurationId: configId,
        systemId,
        status,
        latencyMs,
        result: resultRecord,
        sourceId,
        sourceLabel,
      });

      // Trigger incremental hourly aggregation — same as local executor
      await incrementHourlyAggregate({
        db: tx,
        systemId,
        configurationId: configId,
        status,
        latencyMs,
        runTimestamp: new Date(props.executedAt),
        result: resultRecord,
        collectorRegistry: this.collectorRegistry,
        sourceLabel,
      });
    });
  }
}
