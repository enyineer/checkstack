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
  type RunStats,
  stripEphemeralFields,
} from "@checkstack/healthcheck-common";
import { evaluateCollectorAssertionOutcomes } from "./collector-assertions";
import { summarizeRuns, type StatRun } from "./run-stats.logic";
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
  or,
  InferSelectModel,
  desc,
  gte,
  lte,
  isNull,
  isNotNull,
  inArray,
  max,
} from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import { evaluateHealthStatus } from "./state-evaluator";
import { computeHealthState, type HealthState } from "./health-state";
import { parseHealthEntityId } from "./health-entity-id";
import { stateThresholds } from "./state-thresholds-migrations";
import type { MaintenanceApi } from "@checkstack/maintenance-common";
import type { Logger } from "@checkstack/backend-api";
import { resolveEffectiveEnvironments } from "./effective-environments";
import { incrementHourlyAggregate } from "./realtime-aggregation";
import type {
  HealthCheckRegistry,
  SafeDatabase,
  CollectorRegistry,
} from "@checkstack/backend-api";
import {
  aggregateCollectorData,
  extractLatencies,
  foldRunAssertionStats,
  mergeTieredBuckets,
  reaggregateBuckets,
  countStatuses,
  calculateLatencyStats,
  type NormalizedBucket,
} from "./aggregation-utils";
import { ASSERTIONS_AGG_KEY } from "@checkstack/healthcheck-common";
import {
  extractConfigurationSecrets,
  mergeConfigurationSecrets,
  deleteConfigurationSecrets,
  pruneOrphanedConfigurationSecrets,
  redactSecretFields,
  listPopulatedSecretKeys,
  healthcheckConfigLockKey,
  type GetCollectorSchema,
  type HealthCheckSecretsDeps,
} from "./config-secrets";

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
  /** Environment slices this check currently fans out to (>= 1). */
  sliceCount: number;
  /** How many of {@link sliceCount} slices are currently non-healthy. */
  failingSliceCount: number;
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
    /**
     * Optional — the secrets channel for config credentials. When present,
     * every write extracts inline `x-secret` values into internal secrets
     * (the stored row holds only markers / `${{ secrets.* }}` references)
     * and updates merge blank/absent secrets from the stored row. MUST be
     * provided on every construction that serves writes (router, gitops);
     * kept optional only for read-path and test constructions.
     */
    private secrets?: HealthCheckSecretsDeps,
  ) {}

  /** Schema lookup for a collector entry, or undefined when unregistered. */
  private getCollectorSchema: GetCollectorSchema = (collectorId) =>
    this.collectorRegistry.getCollector(collectorId)?.collector.config.schema;

  /** Schema lookup for a strategy, or undefined when unregistered. */
  private getStrategySchema(strategyId: string) {
    return this.registry.getStrategy(strategyId)?.config.schema;
  }

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
    // Generate the id up front: secret extraction keys internal secrets by
    // configuration id, and the raw values must never reach the row insert.
    const id = crypto.randomUUID();
    let configToStore = data.config;
    let collectorsToStore = data.collectors;

    // Gate extraction on `this.secrets` alone, NOT on the strategy being
    // registered: extractConfigurationSecrets handles an undefined strategy
    // schema (passing the strategy config through untouched) while STILL
    // extracting every registered collector's secrets. Gating on strategySchema
    // would store a registered collector's inline secret as plaintext at rest
    // when the strategy is unregistered - the leak updateConfiguration avoids.
    const strategySchema = this.getStrategySchema(data.strategyId);
    if (this.secrets) {
      const extracted = await extractConfigurationSecrets({
        configurationId: id,
        strategySchema,
        config: data.config,
        collectors: data.collectors,
        getCollectorSchema: this.getCollectorSchema,
        internalSecrets: this.secrets.internalSecrets,
      });
      configToStore = extracted.config;
      collectorsToStore = extracted.collectors;
    }

    try {
      const [config] = await this.db
        .insert(healthCheckConfigurations)
        .values({
          id,
          name: data.name,
          strategyId: data.strategyId,
          config: configToStore,
          collectors: collectorsToStore ?? undefined,
          intervalSeconds: data.intervalSeconds,
          isTemplate: false, // Defaulting for now
        })
        .returning();
      return this.mapConfig(config);
    } catch (error) {
      // The insert never committed, so the just-extracted internal secrets are
      // now orphaned (a config id that owns no row). Delete them so a failed
      // create leaves nothing dangling in the store.
      await this.cleanupExtractedSecrets({
        id,
        config: configToStore,
        collectors: collectorsToStore,
      });
      throw error;
    }
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

  /**
   * Resolve the per-environment slices a (system, config) assignment should
   * enqueue for a ONE-OFF run (the `run_now` automation). Returns the list of
   * environment ids to run, or `[null]` (a single env-less run) when the
   * assignment has no effective environments. Mirrors the executor's fan-out
   * resolution so a manual run covers exactly the same slices the recurring
   * schedule does. Fail-open: a catalog resolution failure collapses to a
   * single env-less run rather than enqueuing nothing.
   */
  async resolveEnqueueEnvironmentIds(props: {
    systemId: string;
    configurationId: string;
    catalogClient: CatalogClient;
    logger: Logger;
  }): Promise<(string | null)[]> {
    const { systemId, configurationId, catalogClient, logger } = props;
    const [assignment] = await this.db
      .select({ environmentIds: systemHealthChecks.environmentIds })
      .from(systemHealthChecks)
      .where(
        and(
          eq(systemHealthChecks.systemId, systemId),
          eq(systemHealthChecks.configurationId, configurationId),
        ),
      );

    let membership: Awaited<
      ReturnType<CatalogClient["resolveSystemEnvironments"]>
    > = [];
    try {
      membership = await catalogClient.resolveSystemEnvironments({ systemId });
    } catch (error) {
      logger.warn(
        `run_now: could not resolve environments for system ${systemId}`,
        error,
      );
    }

    const effectiveEnvs = resolveEffectiveEnvironments({
      environmentIds: assignment?.environmentIds,
      membership,
    });
    return effectiveEnvs.length > 0
      ? effectiveEnvs.map((env) => env.id)
      : [null];
  }

  /**
   * Redact a configuration for a UI/AI read: every `x-secret` field is
   * removed from the strategy config and each collector config. Stored
   * values, `${{ secrets.* }}` references, and even internal markers never
   * leave the backend; the editor treats the absent field as
   * "keep existing" (`keepExistingSecretFields`).
   */
  redactConfiguration(
    configuration: HealthCheckConfiguration,
  ): HealthCheckConfiguration {
    // FAIL CLOSED on an unregistered strategy/collector (plugin uninstalled):
    // without its schema we cannot know which fields are secret, so return an
    // empty config rather than a possibly-secret-bearing one.
    const strategySchema = this.getStrategySchema(configuration.strategyId);
    const config = strategySchema
      ? redactSecretFields({ schema: strategySchema, config: configuration.config })
      : {};
    const collectors = configuration.collectors?.map((entry) => {
      const schema = this.getCollectorSchema(entry.collectorId);
      if (!schema) return { ...entry, config: {} };
      return { ...entry, config: redactSecretFields({ schema, config: entry.config }) };
    });
    // Tell the editor which secret fields ACTUALLY have a stored value (computed
    // from the pre-redaction config), so a never-set optional secret does not
    // show a misleading "a secret is stored" hint / Clear affordance.
    const configuredSecrets = {
      strategy: strategySchema
        ? listPopulatedSecretKeys({
            schema: strategySchema,
            config: configuration.config,
          })
        : [],
      collectors: Object.fromEntries(
        (configuration.collectors ?? []).map((entry) => {
          const schema = this.getCollectorSchema(entry.collectorId);
          return [
            entry.id,
            schema
              ? listPopulatedSecretKeys({ schema, config: entry.config })
              : [],
          ];
        }),
      ),
    };
    return { ...configuration, config, collectors, configuredSecrets };
  }

  async getConfigurationRedacted(
    id: string,
  ): Promise<HealthCheckConfiguration | undefined> {
    const configuration = await this.getConfiguration(id);
    return configuration ? this.redactConfiguration(configuration) : undefined;
  }

  async getConfigurationsRedacted(): Promise<HealthCheckConfiguration[]> {
    const configurations = await this.getConfigurations();
    return configurations.map((c) => this.redactConfiguration(c));
  }

  async updateConfiguration(
    id: string,
    data: UpdateHealthCheckConfiguration,
    options?: {
      /**
       * Whether a blank/absent `x-secret` field means "keep the stored value"
       * (the UI editor round-trips the REDACTED config, so this is `true` by
       * default). GitOps is DECLARATIVE - the authored source is the whole
       * truth, so an omitted secret field means "not set". Pass `false` there
       * so absent secrets are removed rather than silently re-restored.
       */
      mergeSecrets?: boolean;
    },
  ): Promise<HealthCheckConfiguration | undefined> {
    const mergeSecrets = options?.mergeSecrets ?? true;

    const applyUpdate = async (): Promise<
      HealthCheckConfiguration | undefined
    > => {
      let body = data;
      // Deferred until AFTER the row is written: deletes internal secrets
      // orphaned by this edit (a cleared / declaratively-removed field, an
      // inline secret swapped for a reference, a removed collector). Post-write
      // means a crash can never leave the row pointing at a marker whose secret
      // we already deleted (a dangling marker fails closed at run time).
      let pruneOrphans: (() => Promise<void>) | undefined;

      if (this.secrets && (data.config || data.collectors)) {
        // The editor round-trips the REDACTED config, so blank/absent secrets
        // mean "keep existing": restore them from the stored row BEFORE
        // extraction (restored markers pass through extraction untouched).
        const stored = await this.getConfiguration(id);
        if (stored) {
          const strategyId = data.strategyId ?? stored.strategyId;
          const strategySchema = this.getStrategySchema(strategyId);

          // Preserve an UNREGISTERED collector entry's stored config: a read
          // redacts it to `{}` (fail-closed), and the editor round-trips that
          // back - never persist the `{}` over the stored config.
          const storedById = new Map(
            (stored.collectors ?? []).map((entry) => [entry.id, entry]),
          );
          const sanitizedCollectors = data.collectors?.map((entry) => {
            if (this.getCollectorSchema(entry.collectorId)) return entry;
            const storedEntry = storedById.get(entry.id);
            return storedEntry
              ? { ...entry, config: storedEntry.config }
              : entry;
          });

          // Strategy config: registered -> merge/extract (or wholesale for
          // gitops); UNREGISTERED -> preserve the stored config (we have no
          // schema to merge/extract/validate it). REGISTERED COLLECTORS are
          // processed via their OWN schemas regardless of strategy
          // registration, so a registered collector under an unregistered
          // strategy still extracts its secrets (no plaintext-at-rest, no wipe).
          const incomingStrategyConfig = strategySchema
            ? (data.config ?? stored.config)
            : stored.config;

          // UI keeps existing secrets (blank = keep); GitOps applies the
          // authored config wholesale so an omitted secret is genuinely removed.
          const merged = mergeSecrets
            ? mergeConfigurationSecrets({
                strategySchema,
                incomingConfig: incomingStrategyConfig,
                storedConfig: stored.config,
                incomingCollectors: sanitizedCollectors,
                storedCollectors: stored.collectors,
                getCollectorSchema: this.getCollectorSchema,
              })
            : { config: incomingStrategyConfig, collectors: sanitizedCollectors };

          const extracted = await extractConfigurationSecrets({
            configurationId: id,
            strategySchema,
            config: merged.config,
            collectors: merged.collectors,
            getCollectorSchema: this.getCollectorSchema,
            internalSecrets: this.secrets.internalSecrets,
          });
          body = {
            ...data,
            ...(data.config ? { config: extracted.config } : {}),
            ...(data.collectors ? { collectors: extracted.collectors } : {}),
          };

          // A partial update only changes provided fields, so the effective new
          // state of an omitted field is the stored one (unchanged, no orphan).
          const newConfig = data.config ? extracted.config : stored.config;
          const newCollectors = data.collectors
            ? extracted.collectors
            : stored.collectors;
          const secrets = this.secrets;
          pruneOrphans = async () => {
            await pruneOrphanedConfigurationSecrets({
              configurationId: id,
              oldConfig: stored.config,
              newConfig,
              oldCollectors: stored.collectors,
              newCollectors,
              internalSecrets: secrets.internalSecrets,
            });
          };
        }
      }

      const [config] = await this.db
        .update(healthCheckConfigurations)
        .set({
          ...body,
          updatedAt: new Date(),
        })
        .where(eq(healthCheckConfigurations.id, id))
        .returning();

      // The row now holds the new markers; delete the internal secrets this
      // edit orphaned. Post-write so a dangling marker can never outlive its
      // secret.
      if (config) await pruneOrphans?.();

      return config ? this.mapConfig(config) : undefined;
    };

    // Serialize the read-modify-write-prune per config id so a concurrent
    // writer to the SAME id (e.g. a UI edit racing a GitOps reconcile across
    // pods) cannot have its just-written secret deleted by this writer's stale
    // orphan-prune, which would leave a dangling marker. Only needed on the
    // secret-bearing path and only when a cluster-wide lock is wired.
    const lock = this.secrets?.advisoryLock;
    if (lock && (data.config || data.collectors)) {
      return lock.withXactLock({
        key: healthcheckConfigLockKey(id),
        fn: applyUpdate,
      });
    }
    return applyUpdate();
  }

  /**
   * Restore a stored config's secrets into a proposed (redacted) config so it
   * can be deep-validated as an UPDATE without spuriously failing a
   * required-secret check. Mirrors the merge `updateConfiguration` does
   * before persisting, so validate and apply agree; the restored values are
   * used only for validation and never returned to the caller. Returns the
   * proposed config unchanged when the id is unknown or secrets are not wired.
   */
  async restoreSecretsForValidation({
    existingConfigurationId,
    strategyId,
    config,
    collectors,
  }: {
    existingConfigurationId: string;
    strategyId: string;
    config: Record<string, unknown>;
    collectors: CollectorConfigEntry[] | undefined;
  }): Promise<{
    config: Record<string, unknown>;
    collectors: CollectorConfigEntry[] | undefined;
  }> {
    const strategySchema = this.getStrategySchema(strategyId);
    const stored = await this.getConfiguration(existingConfigurationId);
    if (!strategySchema || !stored) return { config, collectors };
    return mergeConfigurationSecrets({
      strategySchema,
      incomingConfig: config,
      storedConfig: stored.config,
      incomingCollectors: collectors,
      storedCollectors: stored.collectors,
      getCollectorSchema: this.getCollectorSchema,
    });
  }

  async deleteConfiguration(id: string): Promise<void> {
    const applyDelete = async (): Promise<void> => {
      // Clean up the internal secrets the stored markers point at BEFORE the
      // row disappears (the markers are the only index into them). Schema-free,
      // so an uninstalled strategy/collector plugin does NOT leave its secrets
      // orphaned - marker enumeration does not depend on the plugin being loaded.
      if (this.secrets) {
        const stored = await this.getConfiguration(id);
        if (stored) {
          await deleteConfigurationSecrets({
            configurationId: id,
            config: stored.config,
            collectors: stored.collectors,
            internalSecrets: this.secrets.internalSecrets,
          });
        }
      }
      await this.db
        .delete(healthCheckConfigurations)
        .where(eq(healthCheckConfigurations.id, id));
    };

    // Serialize delete under the SAME per-config lock updateConfiguration uses,
    // so a concurrent update on this id cannot interleave: a delete reading the
    // pre-update row would clean up the OLD markers and drop the row while the
    // update writes a fresh internal secret, orphaning it. Delete and update of
    // one id must be mutually exclusive.
    const lock = this.secrets?.advisoryLock;
    if (lock) {
      return lock.withXactLock({
        key: healthcheckConfigLockKey(id),
        fn: applyDelete,
      });
    }
    return applyDelete();
  }

  /**
   * Delete internal secrets extracted for a config whose row insert did NOT
   * commit (a rolled-back create), so a failed create never orphans the
   * secrets it extracted. Best-effort: swallows cleanup errors so the original
   * insert error is the one surfaced.
   */
  private async cleanupExtractedSecrets({
    id,
    config,
    collectors,
  }: {
    id: string;
    config: Record<string, unknown>;
    collectors: CollectorConfigEntry[] | undefined;
  }): Promise<void> {
    if (!this.secrets) return;
    try {
      await deleteConfigurationSecrets({
        configurationId: id,
        config,
        collectors,
        internalSecrets: this.secrets.internalSecrets,
      });
    } catch {
      // Ignore: the create already failed; surfacing a cleanup error would mask
      // the real cause. The orphan (if any) is a harmless encrypted blob.
    }
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
   * Atomically create a health-check configuration AND assign it to a system in
   * a single transaction. Backs the `createAndAssign` RPC: the common 1-1
   * onboarding case ("this system gets one check") can never leave a dormant,
   * unassigned check because the config row and its `systemHealthChecks`
   * assignment row commit together or not at all. Scheduling of the first run
   * is the caller's (router's) responsibility, mirroring `associateSystem`.
   */
  async createAndAssign(props: {
    configuration: CreateHealthCheckConfiguration;
    systemId: string;
    enabled?: boolean;
    stateThresholds?: StateThresholds;
    satelliteIds?: string[];
    /**
     * Per-assignment environment selector. `null` (or `undefined`) = all
     * current environments; `[]` = opt out (env-less); non-empty = those ids.
     */
    environmentIds?: string[] | null;
    includeLocal?: boolean;
    notificationPolicy?: NotificationPolicy;
  }): Promise<HealthCheckConfiguration> {
    const {
      configuration,
      systemId,
      enabled = true,
      stateThresholds: stateThresholds_,
      satelliteIds,
      environmentIds,
      includeLocal = true,
      notificationPolicy,
    } = props;

    // Preserve the null/[]/list distinction faithfully (see associateSystem).
    const environmentIdsValue: string[] | null = environmentIds ?? null;
    const versionedThresholds: VersionedStateThresholds | undefined =
      stateThresholds_ ? stateThresholds.create(stateThresholds_) : undefined;

    // Extract inline secrets into the encrypted internal store BEFORE insert -
    // identical to createConfiguration. Without this, the first-check wizard
    // and the AI propose tool (both createAndAssign callers) would persist
    // credentials as plaintext. The id is generated up front so the internal
    // secrets can be keyed by it.
    const id = crypto.randomUUID();
    let configToStore = configuration.config;
    let collectorsToStore = configuration.collectors;
    // Gate on `this.secrets` alone (see createConfiguration): gating on
    // strategySchema would leave a registered collector's inline secret as
    // plaintext at rest when the strategy is unregistered.
    const strategySchema = this.getStrategySchema(configuration.strategyId);
    if (this.secrets) {
      const extracted = await extractConfigurationSecrets({
        configurationId: id,
        strategySchema,
        config: configuration.config,
        collectors: configuration.collectors,
        getCollectorSchema: this.getCollectorSchema,
        internalSecrets: this.secrets.internalSecrets,
      });
      configToStore = extracted.config;
      collectorsToStore = extracted.collectors;
    }

    let created: typeof healthCheckConfigurations.$inferSelect;
    try {
      created = await this.db.transaction(async (tx) => {
        const [config] = await tx
          .insert(healthCheckConfigurations)
          .values({
            id,
            name: configuration.name,
            strategyId: configuration.strategyId,
            config: configToStore,
            collectors: collectorsToStore ?? undefined,
            intervalSeconds: configuration.intervalSeconds,
            isTemplate: false,
          })
          .returning();

        await tx.insert(systemHealthChecks).values({
          systemId,
          configurationId: config.id,
          enabled,
          stateThresholds: versionedThresholds,
          satelliteIds: satelliteIds ?? undefined,
          environmentIds: environmentIdsValue,
          includeLocal,
          notificationPolicy: notificationPolicy ?? undefined,
        });

        return config;
      });
    } catch (error) {
      // The transaction rolled back, so no row owns the secrets we just
      // extracted; delete them so a failed create-and-assign never orphans them.
      await this.cleanupExtractedSecrets({
        id,
        config: configToStore,
        collectors: collectorsToStore,
      });
      throw error;
    }

    return this.mapConfig(created);
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
   * System-scoped configuration list for UI reads - REDACTED, like
   * `getConfigurationsRedacted`. Any `x-secret` field is stripped before the
   * config leaves the backend.
   */
  async getSystemConfigurationsRedacted(
    systemId: string,
  ): Promise<HealthCheckConfiguration[]> {
    const configurations = await this.getSystemConfigurations(systemId);
    return configurations.map((c) => this.redactConfiguration(c));
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
   * List the IDs of every system an ENABLED assignment of `configurationId`
   * targets. Used by the pause/resume RPC handlers to know which systems'
   * rollup `health` entity must be recomputed when a configuration's `paused`
   * flag flips (because `getSystemHealthStatus` excludes paused configs, the
   * recomputed rollup may transition healthy → degraded or vice-versa, and
   * that transition drives downstream SLO downtime open/close).
   *
   * Only ENABLED assignments are returned: a disabled assignment never
   * contributed to system health, so flipping `paused` on its config has no
   * effect on that system's aggregate.
   */
  async getSystemIdsForConfiguration(
    configurationId: string,
  ): Promise<string[]> {
    const rows = await this.db
      .select({ systemId: systemHealthChecks.systemId })
      .from(systemHealthChecks)
      .where(
        and(
          eq(systemHealthChecks.configurationId, configurationId),
          eq(systemHealthChecks.enabled, true),
        ),
      );
    return rows.map((r) => r.systemId);
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
   *    runs for the system, grouped by `environment_id` per association and
   *    evaluated per-env, then worst-wins ACROSS environments within each
   *    association (unhealthy > degraded > healthy). This is stable regardless
   *    of env insertion order or multi-pod racing; flattening envs into one
   *    list feeds interleaved statuses to the consecutive evaluator and breaks
   *    the streak on the first interleaving env (masking / flapping). For an
   *    assignment with a single env (or env-less only) this reduces to the
   *    pre-existing flat-window behavior.
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
          // A paused configuration contributes no signal to the system's
          // health: its execution is skipped (see queue-executor pause gate)
          // and its historical runs MUST NOT keep the aggregate degraded
          // while it is paused. Excluding it here makes the rollup reflect
          // only the actively-running checks, so pausing the sole failing
          // check clears the system's status and downstream SLO downtime.
          eq(healthCheckConfigurations.paused, false),
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
    //
    // For the rollup, we deliberately do NOT apply a single envFilter to one
    // flat run list — see the per-association branch below for why.
    const envFilter =
      environmentId === undefined
        ? undefined
        : environmentId === null
          ? isNull(healthCheckRuns.environmentId)
          : eq(healthCheckRuns.environmentId, environmentId);

    for (const assoc of associations) {
      // Extract and migrate thresholds from versioned config
      let thresholds: StateThresholds | undefined;
      if (assoc.stateThresholds) {
        thresholds = await stateThresholds.parse(assoc.stateThresholds);
      }

      let status: HealthCheckStatus;
      let runsConsidered: number;
      let lastRunAt: Date | undefined;
      // Fan-out accounting for the honest "X of Y checks failing" denominator:
      // how many environment slices this check currently spans, and how many
      // are non-healthy. A non-fanned (single-env / env-less) check is one
      // slice. Populated in both branches so the DTO field is always present.
      let sliceCount = 1;
      let failingSliceCount = 0;

      if (environmentId === undefined) {
        // System rollup: evaluate the threshold window PER ENVIRONMENT within
        // the association, then take worst-wins ACROSS envs. Flattening every
        // env's runs into one list feeds interleaved statuses to
        // `evaluateConsecutive` (the default mode): the streak breaks on the
        // first interleaving env, so the evaluator collapses to whatever
        // single env's status the most recent run landed on. That masks any
        // permanently-failing sibling env in the default mode ("the healthy
        // env wins"), and flaps healthy↔degraded whenever env insertion
        // order drifts across ticks (see the regression test
        // `rollup — worst-wins across environments within an association`).
        // Per-env evaluation makes the rollup worst-wins stable regardless of
        // insertion order or multi-pod racing.
        const runs = await this.db
          .select({
            status: healthCheckRuns.status,
            timestamp: healthCheckRuns.timestamp,
            environmentId: healthCheckRuns.environmentId,
          })
          .from(healthCheckRuns)
          .where(
            and(
              eq(healthCheckRuns.systemId, systemId),
              eq(healthCheckRuns.configurationId, assoc.configurationId),
            ),
          )
          .orderBy(desc(healthCheckRuns.timestamp))
          .limit(maxWindowSize);

        // Group by environmentId. `null` is its own group (the env-less slice
        // of an assignment that has opted out, plus any pre-3b env-less runs).
        const byEnv = new Map<string | null, { status: HealthCheckStatus; timestamp: Date }[]>();
        for (const r of runs) {
          const key = r.environmentId ?? null;
          const bucket = byEnv.get(key);
          if (bucket) {
            bucket.push(r);
          } else {
            byEnv.set(key, [r]);
          }
        }

        status = "healthy";
        runsConsidered = runs.length;
        lastRunAt = runs[0]?.timestamp;
        // Each env group is a slice. A check that has runs against N envs
        // currently fans out to N; before it has ever run it is still one
        // logical slice (byEnv empty => keep the default 1).
        sliceCount = Math.max(byEnv.size, 1);
        failingSliceCount = 0;
        for (const envRuns of byEnv.values()) {
          const envStatus = evaluateHealthStatus({ runs: envRuns, thresholds });
          // Count EVERY failing slice (don't break early): the failing count
          // feeds the dashboard numerator, so all non-healthy envs must tally.
          if (envStatus !== "healthy") {
            failingSliceCount++;
          }
          if (envStatus === "unhealthy") {
            status = "unhealthy";
          } else if (envStatus === "degraded" && status === "healthy") {
            status = "degraded";
          }
        }
      } else {
        // Per-env (string) or env-less (null) slice: that slice's flat run
        // window is monotonic per-env, so the threshold evaluator sees no
        // interleaving — the consecutive streak is well-defined.
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

        status = evaluateHealthStatus({ runs, thresholds });
        runsConsidered = runs.length;
        lastRunAt = runs[0]?.timestamp;
        // Single-slice evaluation: this env either counts as failing or not.
        sliceCount = 1;
        failingSliceCount = status === "healthy" ? 0 : 1;
      }

      checkStatuses.push({
        configurationId: assoc.configurationId,
        configurationName: assoc.configName,
        status,
        runsConsidered,
        lastRunAt,
        sliceCount,
        failingSliceCount,
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
   * Bulk per-(system, check, environment) health for the given systems.
   *
   * For each system returns the cross-environment rollup (status +
   * checkStatuses, same as {@link getSystemHealthStatus}) PLUS a slice per
   * environment the system has runs for. Consumers that scope by environment
   * (the dependency map) must read the per-environment slice, because the
   * rollup deliberately hides a single failing environment.
   *
   * Cost scales with the number of environments each system actually fans out
   * to (`1 + #envs` status evaluations per system); systems with only env-less
   * runs cost the same as a plain rollup read. Not on any per-run hot path.
   */
  async getBulkSystemHealthMatrix(systemIds: string[]): Promise<
    Record<
      string,
      {
        status: HealthCheckStatus;
        checkStatuses: SystemHealthStatusResponse["checkStatuses"];
        environments: Record<
          string,
          {
            status: HealthCheckStatus;
            checkStatuses: SystemHealthStatusResponse["checkStatuses"];
          }
        >;
      }
    >
  > {
    const result: Record<
      string,
      {
        status: HealthCheckStatus;
        checkStatuses: SystemHealthStatusResponse["checkStatuses"];
        environments: Record<
          string,
          {
            status: HealthCheckStatus;
            checkStatuses: SystemHealthStatusResponse["checkStatuses"];
          }
        >;
      }
    > = {};

    await Promise.all(
      systemIds.map(async (systemId) => {
        const overall = await this.getSystemHealthStatus(systemId);

        // Environments this system actually has runs for (env-less excluded -
        // it is folded into the rollup and never a real environment id).
        const envRows = await this.db
          .selectDistinct({ environmentId: healthCheckRuns.environmentId })
          .from(healthCheckRuns)
          .where(
            and(
              eq(healthCheckRuns.systemId, systemId),
              isNotNull(healthCheckRuns.environmentId),
            ),
          );

        const environments: Record<
          string,
          {
            status: HealthCheckStatus;
            checkStatuses: SystemHealthStatusResponse["checkStatuses"];
          }
        > = {};
        await Promise.all(
          envRows.map(async ({ environmentId }) => {
            if (!environmentId) return;
            const envStatus = await this.getSystemHealthStatus(
              systemId,
              environmentId,
            );
            environments[environmentId] = {
              status: envStatus.status,
              checkStatuses: envStatus.checkStatuses,
            };
          }),
        );

        result[systemId] = {
          status: overall.status,
          checkStatuses: overall.checkStatuses,
          environments,
        };
      }),
    );

    return result;
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
        paused: healthCheckConfigurations.paused,
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
          environmentId: healthCheckRuns.environmentId,
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

      // Most recent HEALTHY run per environment, computed OUTSIDE the bounded
      // sparkline window so "last successful run" stays correct even when a
      // check has been failing for far longer than the last 25 runs. One
      // grouped aggregate query per check (env-less = the `null` group). The
      // (system_id, configuration_id, environment_id, timestamp) index makes
      // this a cheap max-per-group scan.
      const lastHealthyRows = await this.db
        .select({
          environmentId: healthCheckRuns.environmentId,
          lastSuccessAt: max(healthCheckRuns.timestamp),
        })
        .from(healthCheckRuns)
        .where(
          and(
            eq(healthCheckRuns.systemId, systemId),
            eq(healthCheckRuns.configurationId, assoc.configurationId),
            eq(healthCheckRuns.status, "healthy"),
          ),
        )
        .groupBy(healthCheckRuns.environmentId);
      const lastHealthyByEnv = new Map<string | null, Date>();
      let checkLastSuccessfulRunAt: Date | undefined;
      for (const row of lastHealthyRows) {
        if (!row.lastSuccessAt) continue;
        lastHealthyByEnv.set(row.environmentId ?? null, row.lastSuccessAt);
        if (
          !checkLastSuccessfulRunAt ||
          row.lastSuccessAt > checkLastSuccessfulRunAt
        ) {
          checkLastSuccessfulRunAt = row.lastSuccessAt;
        }
      }

      // Group the fetched runs by environmentId (null = env-less slice). We
      // query each env's slice separately below to evaluate it on its own
      // monotonic run window and worst-wins across envs — this is the same
      // derivation `getSystemHealthStatus(systemId)` uses for the rollup; see
      // that method for the rationale (flattening envs feeds interleaved
      // statuses to the consecutive evaluator and masks sibling outages).
      const perEnvironment: {
        environmentId: string | null;
        status: HealthCheckStatus;
        lastSuccessfulRunAt?: Date;
        recentRuns: { id: string; status: HealthCheckStatus; timestamp: Date }[];
      }[] = [];

      // Stable ordering of env keys: env-less (`null`) first, then env ids in
      // the order they were first encountered in the mixed pool (membership
      // order is otherwise unobservable here without a catalog read; recent
      // runs surface stable, recent order).
      const envKeys: (string | null)[] = [];
      const seenEnv = new Set<string | null>();
      for (const r of runs) {
        const key = r.environmentId ?? null;
        if (!seenEnv.has(key)) {
          seenEnv.add(key);
          envKeys.push(key);
        }
      }
      // If no runs at all, surface a single env-less entry so UI can render
      // an empty row rather than nothing.
      if (envKeys.length === 0) envKeys.push(null);

      let aggregateStatus: HealthCheckStatus = "healthy";
      for (const envId of envKeys) {
        const envRuns = await this.db
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
              envId === null
                ? isNull(healthCheckRuns.environmentId)
                : eq(healthCheckRuns.environmentId, envId),
            ),
          )
          .orderBy(desc(healthCheckRuns.timestamp))
          .limit(sparklineLimit);

        const envStatus = evaluateHealthStatus({
          runs: envRuns,
          thresholds,
        });
        // Worst-wins across envs (unhealthy > degraded > healthy).
        if (envStatus === "unhealthy") {
          aggregateStatus = "unhealthy";
        } else if (envStatus === "degraded" && aggregateStatus === "healthy") {
          aggregateStatus = "degraded";
        }

        perEnvironment.push({
          environmentId: envId,
          status: envStatus,
          lastSuccessfulRunAt: lastHealthyByEnv.get(envId),
          recentRuns: envRuns.toReversed().map((r) => ({
            id: r.id,
            status: r.status,
            timestamp: r.timestamp,
          })),
        });
      }

      // Evaluate current status (runs are in DESC order - newest first - as evaluateHealthStatus expects).
      // For a paused configuration the runs are stale (execution is skipped),
      // so the evaluated `status` is NOT a meaningful current verdict — the
      // frontend renders a "Paused" pill from the `paused` flag instead.
      // We still compute it so the historical/sparkline path stays uniform,
      // and so a non-paused consumer that ignores `paused` sees a best-
      // effort status rather than a hard null. `aggregateStatus` is the
      // worst-wins-across-envs rollup derived above (it equals what
      // evaluateHealthStatus would return on the flat pool if only ONE env is
      // present, preserving per-check single-env behavior).
      const status = aggregateStatus;

      checks.push({
        configurationId: assoc.configurationId,
        configurationName: assoc.configName,
        strategyId: assoc.strategyId,
        intervalSeconds: assoc.intervalSeconds,
        enabled: assoc.enabled,
        paused: assoc.paused,
        status,
        stateThresholds: thresholds,
        lastSuccessfulRunAt: checkLastSuccessfulRunAt,
        recentRuns: chronologicalRuns.map((r) => ({
          id: r.id,
          status: r.status,
          timestamp: r.timestamp,
          environmentId: r.environmentId,
        })),
        perEnvironment,
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
    environmentId?: string | null;
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
      environmentId,
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

    // Environment filtering (server-side). `null` selects the env-less slice;
    // a string selects that env; `undefined` leaves all envs in the window.
    // The drawer relies on this to scope its Recent Runs table to the env the
    // operator clicked, so the total + the paginated rows reflect only the
    // (check, environment) pair — not the mixed-env pool.
    if (environmentId === null) {
      conditions.push(isNull(healthCheckRuns.environmentId));
    } else if (environmentId !== undefined) {
      conditions.push(eq(healthCheckRuns.environmentId, environmentId));
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
   * Compact run statistics over a window: totals + a small, capped bucket series.
   * Backs the `healthcheck.runStats` AI tool so the assistant can answer
   * "how often / how much downtime / uptime over the last N days" WITHOUT pulling
   * thousands of raw rows into its context. Selects only the three columns the
   * stats need and aggregates with the pure `summarizeRuns` helper. Same public
   * gate as `getHistory` (no `result` payload is read).
   */
  async getRunStats(props: {
    systemId?: string;
    configurationId?: string;
    startDate: Date;
    endDate: Date;
    sourceFilter?: string;
    statusFilter?: HealthCheckStatus[];
    environmentId?: string | null;
    maxBuckets?: number;
  }): Promise<RunStats> {
    const {
      systemId,
      configurationId,
      startDate,
      endDate,
      sourceFilter,
      statusFilter,
      environmentId,
      maxBuckets = 24,
    } = props;

    const conditions = [
      gte(healthCheckRuns.timestamp, startDate),
      lte(healthCheckRuns.timestamp, endDate),
    ];
    if (systemId) conditions.push(eq(healthCheckRuns.systemId, systemId));
    if (configurationId)
      conditions.push(eq(healthCheckRuns.configurationId, configurationId));
    if (sourceFilter === "local") {
      conditions.push(isNull(healthCheckRuns.sourceId));
    } else if (sourceFilter) {
      conditions.push(eq(healthCheckRuns.sourceId, sourceFilter));
    }
    if (statusFilter && statusFilter.length > 0) {
      conditions.push(inArray(healthCheckRuns.status, statusFilter));
    }
    // Server-side env filter; same semantics as `getHistory`.
    if (environmentId === null) {
      conditions.push(isNull(healthCheckRuns.environmentId));
    } else if (environmentId !== undefined) {
      conditions.push(eq(healthCheckRuns.environmentId, environmentId));
    }

    const rows = await this.db
      .select({
        timestamp: healthCheckRuns.timestamp,
        status: healthCheckRuns.status,
        latencyMs: healthCheckRuns.latencyMs,
      })
      .from(healthCheckRuns)
      .where(and(...conditions));

    const runs: StatRun[] = rows.map((r) => ({
      timestamp: r.timestamp,
      status: r.status,
      latencyMs: r.latencyMs ?? undefined,
    }));

    return summarizeRuns({ runs, startDate, endDate, maxBuckets });
  }

  /**
   * Get detailed health check run history with full result data.
   * Restricted to users with manage access.
   * @param sortOrder - 'asc' for chronological (oldest first), 'desc' for reverse (newest first)
   */
  /**
   * Distinct system ids that have at least one recorded run - the candidate
   * set for scoping the run-history feed by SYSTEM manage access (a system's
   * owning team sees every run of that system).
   */
  async getRunSystemIds(): Promise<string[]> {
    const rows = await this.db
      .selectDistinct({ systemId: healthCheckRuns.systemId })
      .from(healthCheckRuns);
    return rows.map((r) => r.systemId);
  }

  async getDetailedHistory(props: {
    systemId?: string;
    configurationId?: string;
    /**
     * Restrict the feed to a team-scoped caller's slice: runs of their
     * configurations OR runs belonging to their systems (a system's owning
     * team sees every run of that system). Applied on TOP of the other
     * filters; both `total` and the page respect it, so pagination stays
     * correct for a filtered feed. At least one array must be non-empty
     * (an entirely-empty scope is the caller's "forbidden" case, decided
     * before the query).
     */
    teamScope?: { configurationIds: string[]; systemIds: string[] };
    startDate?: Date;
    endDate?: Date;
    sourceFilter?: string;
    statusFilter?: HealthCheckStatus[];
    environmentId?: string | null;
    limit?: number;
    offset?: number;
    sortOrder: "asc" | "desc";
  }) {
    const {
      systemId,
      configurationId,
      teamScope,
      startDate,
      endDate,
      sourceFilter,
      statusFilter,
      environmentId,
      limit = 10,
      offset = 0,
      sortOrder,
    } = props;

    const conditions = [];
    if (systemId) conditions.push(eq(healthCheckRuns.systemId, systemId));
    if (configurationId)
      conditions.push(eq(healthCheckRuns.configurationId, configurationId));
    if (teamScope) {
      // drizzle's inArray rejects empty arrays, so only include non-empty
      // branches of the OR.
      const scopeBranches = [];
      if (teamScope.configurationIds.length > 0) {
        scopeBranches.push(
          inArray(healthCheckRuns.configurationId, teamScope.configurationIds),
        );
      }
      if (teamScope.systemIds.length > 0) {
        scopeBranches.push(
          inArray(healthCheckRuns.systemId, teamScope.systemIds),
        );
      }
      if (scopeBranches.length === 0) {
        // Defensive: an empty scope must never widen to the full feed.
        return { runs: [], total: 0 };
      }
      conditions.push(
        scopeBranches.length === 1 ? scopeBranches[0] : or(...scopeBranches),
      );
    }
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

    // Server-side env filter; same semantics as `getHistory`.
    if (environmentId === null) {
      conditions.push(isNull(healthCheckRuns.environmentId));
    } else if (environmentId !== undefined) {
      conditions.push(eq(healthCheckRuns.environmentId, environmentId));
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
      environmentId?: string | null;
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
      environmentId,
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

    // Server-side env filter applied to ALL three tiers (raw runs, hourly
    // and daily aggregates), since `health_check_runs.environment_id` and
    // `health_check_aggregates.environment_id` are the same env-id domain.
    // The bucket uniqueness on `health_check_aggregates` includes `environmentId`
    // (with NULLS NOT DISTINCT), so `isNull(...)` selects the env-less buckets
    // and `eq(...)` selects that env's buckets.
    const envRunCondition =
      environmentId === undefined
        ? undefined
        : environmentId === null
          ? isNull(healthCheckRuns.environmentId)
          : eq(healthCheckRuns.environmentId, environmentId);
    const envAggCondition =
      environmentId === undefined
        ? undefined
        : environmentId === null
          ? isNull(healthCheckAggregates.environmentId)
          : eq(healthCheckAggregates.environmentId, environmentId);

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
      ...(envRunCondition ? [envRunCondition] : []),
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
      ...(envAggCondition ? [envAggCondition] : []),
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
      ...(envAggCondition ? [envAggCondition] : []),
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

        // Per-assertion pass/fail counts (platform-owned, sibling of
        // `collectors` — see assertion-analytics in healthcheck-common).
        const assertionStats = foldRunAssertionStats(bucket.runs);

        aggregatedResult = {
          ...strategyResult,
          ...(collectorsAggregated ? { collectors: collectorsAggregated } : {}),
          ...(assertionStats === undefined
            ? {}
            : { [ASSERTIONS_AGG_KEY]: assertionStats }),
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
          environmentId: healthCheckRuns.environmentId,
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
          environmentId: r.environmentId,
        })),
      });
    }

    return results;
  }

  /**
   * Ingest a health check result from a satellite.
   * Stores the run with source attribution (sourceId + sourceLabel)
   * and triggers incremental aggregation to keep charts/availability current.
   *
   * Assertions are evaluated HERE, on the core, not on the satellite: the
   * satellite never held the assertion semantics, so historically
   * satellite-executed checks silently skipped assertions entirely.
   * Evaluating at ingest fixes that for every satellite version with no
   * wire-protocol change. Caveat: buffered results are evaluated against the
   * configuration CURRENT at ingest time. Ephemeral result fields (e.g. raw
   * HTTP bodies) are needed for JSONPath assertions and are stripped right
   * after evaluation, matching what the local executor stores.
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
    const { configId, systemId, latencyMs, result, sourceId, sourceLabel } =
      props;

    const resultRecord = result
      ? ({ ...result } as Record<string, unknown>)
      : {};

    let status = props.status;
    const metadata = resultRecord.metadata as
      | Record<string, unknown>
      | undefined;
    const collectorsMeta = metadata?.collectors as
      | Record<string, Record<string, unknown>>
      | undefined;
    if (collectorsMeta && Object.keys(collectorsMeta).length > 0) {
      const [configRow] = await this.db
        .select({ collectors: healthCheckConfigurations.collectors })
        .from(healthCheckConfigurations)
        .where(eq(healthCheckConfigurations.id, configId));
      const entries: CollectorConfigEntry[] = configRow?.collectors ?? [];

      let firstFailure: string | undefined;
      const nextCollectorsMeta: Record<string, Record<string, unknown>> = {
        ...collectorsMeta,
      };
      for (const entry of entries) {
        const entryResult = nextCollectorsMeta[entry.id];
        if (!entryResult || typeof entryResult !== "object") continue;

        let evaluated: Record<string, unknown> = { ...entryResult };
        if (entry.assertions?.length) {
          const evaluation = evaluateCollectorAssertionOutcomes({
            assertions: entry.assertions,
            result: evaluated,
          });
          evaluated._assertions = evaluation.outcomes;
          evaluated._assertionFailed = evaluation.firstFailureMessage;
          if (
            evaluation.firstFailureMessage !== undefined &&
            firstFailure === undefined
          ) {
            firstFailure = evaluation.firstFailureMessage;
          }
        }

        // Parity with the local executor: satellites send raw results, so
        // ephemeral fields (assertable but never persisted) get stripped
        // here, AFTER assertions ran against them.
        const registered = this.collectorRegistry.getCollector(
          entry.collectorId,
        );
        if (registered) {
          evaluated = stripEphemeralFields(
            evaluated,
            registered.collector.result.schema,
          );
        }
        nextCollectorsMeta[entry.id] = evaluated;
      }

      resultRecord.metadata = { ...metadata, collectors: nextCollectorsMeta };

      // Mirror the local executor: a failed assertion downgrades a run the
      // satellite reported healthy.
      if (firstFailure !== undefined && status === "healthy") {
        status = "unhealthy";
        resultRecord.status = status;
        resultRecord.message = `Check failed: Assertion failed: ${firstFailure}`;
      }
    }

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
