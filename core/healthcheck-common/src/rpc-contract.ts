import { createClientDefinition, proc } from "@checkstack/common";
import { pluginMetadata } from "./plugin-metadata";
import { z } from "zod";
import { healthCheckAccess } from "./access";
import {
  HealthCheckStrategyDtoSchema,
  CollectorDtoSchema,
  HealthCheckConfigurationSchema,
  CreateHealthCheckConfigurationSchema,
  UpdateHealthCheckConfigurationSchema,
  ValidateConfigurationInputSchema,
  ValidateConfigurationResultSchema,
  AssociateHealthCheckSchema,
  CreateAndAssignHealthCheckSchema,
  HealthCheckRunSchema,
  HealthCheckRunPublicSchema,
  HealthCheckStatusSchema,
  HealthCheckRunResultSchema,
  StateThresholdsSchema,
  RetentionConfigSchema,
  AggregatedBucketBaseSchema,
  AggregatedBucketSchema,
  RunStatsSchema,
  NotificationPolicySchema,
} from "./schemas";

// --- Response Schemas for Evaluated Status ---

const SystemCheckStatusSchema = z.object({
  configurationId: z.string(),
  configurationName: z.string(),
  status: HealthCheckStatusSchema,
  runsConsidered: z.number(),
  lastRunAt: z.date().optional(),
  /**
   * Number of environment slices this check CURRENTLY fans out to (worst-wins
   * rollup only). A check with no environments (or opted out) is a single
   * slice, so this is always >= 1. Dashboards sum this across checks to report
   * the honest denominator: a 1-check/3-env system contributes 3, not 1. In a
   * single-env (non-rollup) evaluation this is always 1.
   */
  sliceCount: z.number(),
  /**
   * How many of this check's {@link sliceCount} environment slices are
   * currently non-healthy. Dashboards sum this across checks for the numerator
   * of "X of Y checks failing".
   */
  failingSliceCount: z.number(),
});

/**
 * A non-health-check contributor that raised a system's derived status (via
 * worst-wins). Currently only active incidents contribute an override; the
 * shape is kept source-agnostic (`source`/`sourceId`) so health-common stays
 * decoupled from the contributing plugin. When present, `status` is the exact
 * status that contributor forced; the top-level `status` may still be worse if
 * a health check reported something worse.
 */
const SystemHealthOverrideSchema = z.object({
  status: HealthCheckStatusSchema,
  /** Contributor kind, e.g. "incident". */
  source: z.string(),
  /** Human-readable reason, e.g. the incident title. */
  reason: z.string(),
  /** Opaque id of the contributing record, e.g. the incident id (for linking). */
  sourceId: z.string().optional(),
});
export type SystemHealthOverride = z.infer<typeof SystemHealthOverrideSchema>;

const SystemHealthStatusResponseSchema = z.object({
  status: HealthCheckStatusSchema,
  evaluatedAt: z.date(),
  checkStatuses: z.array(SystemCheckStatusSchema),
  /**
   * The worst active override contributing to `status`, or `null`/absent when
   * no non-health-check contributor raised it. Surfaced so UIs can explain WHY
   * a system reads unhealthy when its checks look fine (e.g. "Forced by
   * incident: <title>").
   */
  override: SystemHealthOverrideSchema.nullable().optional(),
});

export type SystemHealthStatusResponse = z.infer<
  typeof SystemHealthStatusResponseSchema
>;

/**
 * Live health-state snapshot used by the automation sensing layer.
 * Service-typed (backend-to-backend). `inStatusSince` is null when no
 * transition has been recorded; `inStatusForMs` is 0 in that case.
 */
const HealthStateSchema = z.object({
  status: HealthCheckStatusSchema,
  inStatusSince: z.date().nullable(),
  inStatusForMs: z.number(),
  latencyMs: z.number().optional(),
  avgLatencyMs: z.number().optional(),
  p95LatencyMs: z.number().optional(),
  successRate: z.number().optional(),
  lastRunAt: z.date().optional(),
  inMaintenance: z.boolean(),
  /** Count of aggregate status transitions in the trailing window (flapping). */
  transitionsInWindow: z.number(),
  /** The window (minutes) `transitionsInWindow` was counted over. */
  transitionWindowMinutes: z.number(),
  evaluatedAt: z.date(),
});

export type HealthStateResponse = z.infer<typeof HealthStateSchema>;

// --- Collector script testing (in-UI) ---

/**
 * Curated check/system metadata a collector script reads. Every part is
 * optional so a partial sample still runs.
 */
const CollectorTestRunContextSchema = z.object({
  check: z
    .object({
      id: z.string(),
      name: z.string(),
      intervalSeconds: z.number().int(),
    })
    .optional(),
  system: z.object({ id: z.string(), name: z.string() }).optional(),
});

export const CollectorScriptTestInputSchema = z.object({
  kind: z.enum(["typescript", "shell"]),
  script: z.string(),
  config: z.record(z.string(), z.unknown()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  /**
   * The collector's declared secret -> env mapping. The test panel NEVER
   * resolves real secret values: each declared env var gets a
   * `__SECRET_<NAME>__` placeholder by default, or the user override below
   * (decision 4).
   */
  secretEnv: z.record(z.string(), z.string()).optional(),
  /** User-supplied per-secret-NAME override values, masked out of the result. */
  secretOverrides: z.record(z.string(), z.string()).optional(),
  workingDirectory: z.string().optional(),
  runContext: CollectorTestRunContextSchema.optional(),
  timeoutMs: z.number().int().min(100).max(300_000).default(30_000),
});
export type CollectorScriptTestInputDto = z.infer<
  typeof CollectorScriptTestInputSchema
>;

export const CollectorScriptTestResultSchema = z.object({
  result: z.unknown().optional(),
  stdout: z.string(),
  stderr: z.string(),
  exitCode: z.number().int().optional(),
  durationMs: z.number().int().nonnegative(),
  timedOut: z.boolean(),
  error: z.string().optional(),
});
export type CollectorScriptTestResultDto = z.infer<
  typeof CollectorScriptTestResultSchema
>;

// Health Check RPC Contract using oRPC's contract-first pattern
export const healthCheckContract = {
  // ==========================================================================
  // STRATEGY MANAGEMENT (userType: "authenticated" with read access)
  // ==========================================================================

  getStrategies: proc({
    operationType: "query",
    userType: "authenticated",
    access: [healthCheckAccess.configuration.read],
    // Editor utility: lists all strategy types. No config/system instance to
    // scope on, but a team-scoped healthcheck manager (a grant on any check, or
    // create-capability) needs it to render the editor - so gate by ANY grant of
    // the healthcheck type, not the global rule alone.
    instanceAccess: { typeScoped: {} },
  }).output(z.array(HealthCheckStrategyDtoSchema)),

  getCollectors: proc({
    operationType: "query",
    userType: "authenticated",
    access: [healthCheckAccess.configuration.read],
    // Editor utility: lists collectors for a strategy type. Same reasoning as
    // getStrategies - reachable by any team-scoped healthcheck manager.
    instanceAccess: { typeScoped: {} },
  })
    .input(z.object({ strategyId: z.string() }))
    .output(z.array(CollectorDtoSchema)),

  /**
   * Run a collector script (inline-script TS or the shell `script`
   * collector) against an editable sample context, using the same
   * sandboxed runner the real collector uses. Lets operators test a
   * collector script in the editor without scheduling a real execution.
   *
   * Gated by `configuration.manage` because authoring a collector script
   * already executes code on the central backend - same privilege. The
   * run is central-only and time-bounded.
   */
  testCollectorScript: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [healthCheckAccess.configuration.manage],
    // Editor utility: runs a sandboxed script test with no config/system instance
    // to scope on. Gated by MANAGE capability on the healthcheck type (a manage
    // grant on any check, or create-capability), so a team-scoped manager can
    // test a collector script without the global rule. Authoring a script is
    // already the same privilege as running this test.
    instanceAccess: { typeScoped: { action: "manage" } },
  })
    .input(CollectorScriptTestInputSchema)
    .output(CollectorScriptTestResultSchema),

  // ==========================================================================
  // CONFIGURATION MANAGEMENT (userType: "authenticated")
  //
  // Config reads (and the create/update responses) are REDACTED: every
  // `x-secret` field of the strategy config and each collector config is
  // stripped server-side - stored values, `${{ secrets.* }}` references, and
  // internal markers never reach a client or a model context. On update, a
  // blank/absent secret means "keep the stored value".
  // ==========================================================================

  getConfigurations: proc({
    operationType: "query",
    userType: "authenticated",
    access: [healthCheckAccess.configuration.read],
    // List post-filter: each item has a string `.id` matching the
    // `healthcheck.configuration` grant resourceId.
    instanceAccess: { listKey: "configurations" },
  }).output(
    z.object({ configurations: z.array(HealthCheckConfigurationSchema) }),
  ),

  getConfiguration: proc({
    operationType: "query",
    userType: "authenticated",
    access: [healthCheckAccess.configuration.read],
    // Single-config read scoped by the configuration's own id.
    instanceAccess: { idParam: "id" },
  })
    .input(z.object({ id: z.string() }))
    .output(HealthCheckConfigurationSchema.optional()),

  createConfiguration: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [healthCheckAccess.configuration.manage],
    // Create-mode: an optional requested owning team (`teamId`) lets a
    // team member with a create-capability grant create the config; the
    // middleware writes the owning-team grant for the created `id`.
    instanceAccess: { create: { teamIdParam: "teamId", idField: "id" } },
  })
    // Extend (not mutate the base schema) so `teamId` does NOT leak into
    // Update/Validate inputs, which derive from CreateHealthCheckConfigurationSchema.
    .input(
      CreateHealthCheckConfigurationSchema.extend({
        teamId: z.string().optional(),
      }),
    )
    .output(HealthCheckConfigurationSchema),

  /**
   * Deep-validate a proposed health-check configuration WITHOUT persisting it.
   * Runs the SAME strategy/collector resolution + migrate-then-validate-strict
   * logic the create / gitops-apply path uses, so propose-time errors match
   * apply-time errors. Gated by `configuration.manage` (the privilege the
   * create form requires); the mirror of automation's `validateDefinition`.
   */
  validateConfiguration: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [healthCheckAccess.configuration.manage],
    // Editor utility: validates a proposed config without persisting; no existing
    // instance id to scope on (`existingConfigurationId` is optional for create
    // drafts). A team-scoped healthcheck manager validates in the editor, so gate
    // by MANAGE capability on the healthcheck type (typeScoped manage), not the
    // global rule. Mirror of the already-typeScoped testCollectorScript.
    instanceAccess: { typeScoped: { action: "manage" } },
  })
    // `existingConfigurationId` marks this as validating an UPDATE to a stored
    // config: the handler restores that config's stored secrets into the
    // proposed body before validating, so a blank/absent `x-secret` field
    // (the reads are redacted) does not spuriously fail a required-secret
    // check. Validation never returns the restored values. Omit it to
    // validate a brand-new (create) draft, where blank secrets stay required.
    .input(
      ValidateConfigurationInputSchema.extend({
        existingConfigurationId: z.string().optional(),
      }),
    )
    .output(ValidateConfigurationResultSchema),

  updateConfiguration: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [healthCheckAccess.configuration.manage],
    // Update scoped by the configuration's own id.
    instanceAccess: { idParam: "id" },
  })
    .route({ method: "PATCH" })
    .input(
      z.object({
        id: z.string(),
        body: UpdateHealthCheckConfigurationSchema,
      }),
    )
    .output(HealthCheckConfigurationSchema),

  deleteConfiguration: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [healthCheckAccess.configuration.manage],
    // Scoped by the configuration's own id. Input reshaped from a bare
    // `z.string()` to `{ id }` so the middleware can read `input.id`.
    instanceAccess: { idParam: "id" },
  })
    .route({ method: "DELETE" })
    .input(z.object({ id: z.string() }))
    .output(z.void()),

  pauseConfiguration: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [healthCheckAccess.configuration.manage],
    instanceAccess: { idParam: "id" },
  })
    .input(z.object({ id: z.string() }))
    .output(z.void()),

  resumeConfiguration: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [healthCheckAccess.configuration.manage],
    instanceAccess: { idParam: "id" },
  })
    .input(z.object({ id: z.string() }))
    .output(z.void()),

  // ==========================================================================
  // SYSTEM ASSOCIATION (userType: "authenticated")
  // ==========================================================================

  getSystemConfigurations: proc({
    operationType: "query",
    userType: "authenticated",
    access: [healthCheckAccess.configuration.read],
    // Reads all health-check configs associated with a specific system.
    instanceAccess: { parentScope: { resourceType: "catalog.system", action: "read", idParam: "systemId" } },
  })
    .input(z.object({ systemId: z.string() }))
    .output(z.array(HealthCheckConfigurationSchema)),

  getSystemAssociations: proc({
    operationType: "query",
    userType: "authenticated",
    access: [healthCheckAccess.configuration.read],
    // Reads association details (per-assignment config) for a specific system.
    instanceAccess: { parentScope: { resourceType: "catalog.system", action: "read", idParam: "systemId" } },
  })
    .input(z.object({ systemId: z.string() }))
    .output(
      z.array(
        z.object({
          configurationId: z.string(),
          configurationName: z.string(),
          enabled: z.boolean(),
          stateThresholds: StateThresholdsSchema.optional(),
          /** IDs of satellites assigned to execute this health check */
          satelliteIds: z.array(z.string()).optional(),
          /**
           * Per-assignment environment selector. null = all current
           * environments; [] = opt out (env-less); non-empty = those ids.
           */
          environmentIds: z.array(z.string()).nullable().optional(),
          /** Whether to also run this check locally on the core (default: true) */
          includeLocal: z.boolean(),
          /** Per-association notification policy (omitted = platform defaults) */
          notificationPolicy: NotificationPolicySchema.optional(),
        }),
      ),
    ),

  /**
   * Bulk count of health-check assignments per system, keyed by systemId.
   * Powers the catalog manager's per-system "Health Checks" badge for the whole
   * visible list in ONE request instead of an N+1 fan-out of
   * {@link getSystemAssociations} (one request per row, each holding a pooled
   * connection that contends with the run executor). A system with no
   * assignments reports `0`. The output record is keyed by systemId, so
   * `parentScope` with `recordKey` gates EACH entry on the caller's
   * `catalog.system` read grant, matching the per-system read exactly (a
   * team-scoped user only sees counts for systems they may read).
   */
  getBulkAssignedHealthCheckCounts: proc({
    operationType: "query",
    userType: "authenticated",
    access: [healthCheckAccess.configuration.read],
    instanceAccess: {
      parentScope: {
        resourceType: "catalog.system",
        action: "read",
        recordKey: "counts",
      },
    },
  })
    // POST avoids URL-length limits when many systemIds are batched.
    .route({ method: "POST" })
    .input(z.object({ systemIds: z.array(z.string()) }))
    .output(z.object({ counts: z.record(z.string(), z.number()) })),

  associateSystem: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [healthCheckAccess.configuration.manage],
    // Mutation that adds a check association to a system — requires manage on the system.
    instanceAccess: { parentScope: { resourceType: "catalog.system", action: "manage", idParam: "systemId" } },
  })
    .input(
      z.object({
        systemId: z.string(),
        body: AssociateHealthCheckSchema,
      }),
    )
    .output(z.void()),

  /**
   * Atomically create a health-check configuration AND assign it to a system
   * (the common 1-1 onboarding case where a system gets exactly one check).
   * Closes the "dormant unassigned check" gap: a check that is created but
   * never assigned runs nothing. Both writes happen in one transaction, and
   * when `enabled` (the default) the check is scheduled immediately, exactly
   * like `associateSystem`.
   *
   * Authorization is scoped on the TARGET SYSTEM (`catalog.system` manage),
   * since that is the resource the assignment attaches to; the feature-level
   * `configuration.manage` gate also applies. The created config carries no
   * team-ownership grant (matching the GitOps create path); reach for
   * `createConfiguration` + `associateSystem` when the new config must be owned
   * by a specific team.
   */
  createAndAssign: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [healthCheckAccess.configuration.manage],
    instanceAccess: {
      parentScope: {
        resourceType: "catalog.system",
        action: "manage",
        idParam: "systemId",
      },
    },
  })
    .input(CreateAndAssignHealthCheckSchema)
    .output(HealthCheckConfigurationSchema),

  /**
   * Read the platform-wide notification policy defaults. Per-assignment
   * rows with no override inherit these values; admin tooling reads
   * them to populate the defaults editor. Compile-time defaults fill
   * in any unset fields.
   */
  getPlatformNotificationDefaults: proc({
    operationType: "query",
    userType: "authenticated",
    access: [healthCheckAccess.configuration.read],
    // Read-only platform default: fetched on every assignment-editor mount, which
    // team-scoped healthcheck managers reach. Not sensitive (a fallback policy
    // value), so gate by ANY healthcheck grant (typeScoped read), not the global
    // rule. NOTE: the WRITE (setPlatformNotificationDefaults) stays `global: true`
    // on purpose - it rewrites instance-wide defaults for every team, so a single
    // team grant must NOT authorize it (that would be privilege escalation).
    instanceAccess: { typeScoped: {} },
  }).output(NotificationPolicySchema),

  /**
   * Update the platform-wide notification policy defaults. Per-
   * assignment rows that inherit (notificationPolicy = null) will pick
   * up the new values on the next read.
   */
  setPlatformNotificationDefaults: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [healthCheckAccess.configuration.manage],
    // Global utility: updates platform-wide defaults, not scoped to any config or system instance.
    instanceAccess: { global: true },
  })
    .input(NotificationPolicySchema)
    .output(z.void()),

  disassociateSystem: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [healthCheckAccess.configuration.manage],
    // Mutation that removes a check association from a system — requires manage on the system.
    instanceAccess: { parentScope: { resourceType: "catalog.system", action: "manage", idParam: "systemId" } },
  })
    .input(
      z.object({
        systemId: z.string(),
        configId: z.string(),
      }),
    )
    .output(z.void()),

  // ==========================================================================
  // RETENTION CONFIGURATION (userType: "authenticated" with manage access)
  // ==========================================================================

  getRetentionConfig: proc({
    operationType: "query",
    userType: "authenticated",
    access: [healthCheckAccess.configuration.read],
    // Scoped to the health-check configuration by its own id.
    instanceAccess: { idParam: "configurationId" },
  })
    .input(
      z.object({
        systemId: z.string(),
        configurationId: z.string(),
      }),
    )
    .output(
      z.object({
        retentionConfig: RetentionConfigSchema.nullable(),
      }),
    ),

  updateRetentionConfig: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [healthCheckAccess.configuration.manage],
    // Scoped to the health-check configuration by its own id.
    instanceAccess: { idParam: "configurationId" },
  })
    .route({ method: "PATCH" })
    .input(
      z.object({
        systemId: z.string(),
        configurationId: z.string(),
        retentionConfig: RetentionConfigSchema.nullable(),
      }),
    )
    .output(z.void()),

  // ==========================================================================
  // HISTORY & STATUS (userType: "public" with read access)
  // ==========================================================================

  getHistory: proc({
    operationType: "query",
    userType: "public",
    access: [healthCheckAccess.status],
    // Both systemId and configurationId are optional — this is a cross-cutting history query
    // with no guaranteed single resource id to scope on; safe global fallback.
    instanceAccess: { global: true },
  })
    .input(
      z.object({
        systemId: z.string().optional(),
        configurationId: z.string().optional(),
        startDate: z.coerce.date().optional(),
        endDate: z.coerce.date().optional(),
        /** Filter by source: "local" = core only, satellite UUID = specific satellite, undefined = all */
        sourceFilter: z.string().optional(),
        /** Restrict runs to the listed statuses. Omitted/empty = no filter. */
        statusFilter: z.array(HealthCheckStatusSchema).optional(),
        /**
         * Restrict to runs of a single environment. `null` filters to the
         * env-less slice (the opt-out / no-membership case); omitted means
         * no environment filter (all runs of the (system, configuration)).
         * Applied server-side at the DB so the drawer's per-env view gets
         * clean, paginated data — not a client-side filter on top of a
         * mixed-env pool.
         */
        environmentId: z.string().nullish(),
        limit: z.number().optional().default(10),
        offset: z.number().optional().default(0),
        sortOrder: z.enum(["asc", "desc"]),
      }),
    )
    .output(
      z.object({
        runs: z.array(HealthCheckRunPublicSchema),
        total: z.number(),
      }),
    ),

  getRunStats: proc({
    operationType: "query",
    userType: "public",
    access: [healthCheckAccess.status],
    // Cross-cutting aggregate: systemId/configurationId are optional so it can
    // summarize broadly; no single guaranteed resource id to scope on.
    instanceAccess: { global: true },
  })
    .input(
      z.object({
        systemId: z.string().optional(),
        configurationId: z.string().optional(),
        startDate: z.coerce.date(),
        endDate: z.coerce.date(),
        /** Filter by source: "local" = core only, satellite UUID = specific satellite, undefined = all */
        sourceFilter: z.string().optional(),
        /** Restrict the runs counted to the listed statuses. Omitted/empty = all. */
        statusFilter: z.array(HealthCheckStatusSchema).optional(),
        /**
         * Restrict to runs of a single environment (server-side DB filter).
         * `null` → env-less slice; omitted → no env filter (all runs of
         * the (system, configuration)). Same semantics as `getHistory`.
         */
        environmentId: z.string().nullish(),
        /** Max time-series buckets to return (default 24, max 100). */
        maxBuckets: z.number().min(1).max(100).optional().default(24),
      }),
    )
    .output(RunStatsSchema),

  /**
   * Bulk variant of {@link getRunStats}, keyed by systemId. Backs the public
   * status page's `systemHealth` uptime column so a page with N systems pays
   * ONE request instead of an N+1 fan-out of per-system {@link getRunStats}
   * calls (each holding a pooled connection that contends with the run
   * executor). All systems share one `[startDate, endDate]` window and
   * `maxBuckets`. Systems with no runs in the window are OMITTED from `stats`
   * (matching the single endpoint's zero-run semantics: nothing to report).
   *
   * `recordKey: "stats"` mirrors {@link getBulkSystemHealthStatus} exactly (the
   * established bulk-by-systemIds mode on the same public `status` rule) - only
   * the record-key name differs. Each systemId key is post-filtered against the
   * caller's health-status access, so a team-scoped caller only sees stats for
   * systems they may view.
   */
  getBulkRunStats: proc({
    operationType: "query",
    userType: "public",
    access: [healthCheckAccess.status],
    instanceAccess: { recordKey: "stats" },
  })
    // POST avoids URL-length limits when many systemIds are batched.
    .route({ method: "POST" })
    .input(
      z.object({
        systemIds: z.array(z.string()),
        startDate: z.coerce.date(),
        endDate: z.coerce.date(),
        /** Max time-series buckets per system (default 24, max 100). */
        maxBuckets: z.number().min(1).max(100).optional().default(24),
      }),
    )
    .output(z.object({ stats: z.record(z.string(), RunStatsSchema) })),

  /**
   * Global run-history feed (the History page). AUTHORIZED IN THE HANDLER,
   * not declaratively: the caller needs global `configuration.manage` (full
   * feed) OR a team manage grant on a configuration OR manage access to a
   * SYSTEM (a system's owning team sees ALL of its runs, whoever owns the
   * configuration) - the feed is then filtered to exactly those
   * configurations/systems. That OR-with-row-filtering on a PAGINATED list is
   * not expressible with the middleware's instanceAccess modes (`listKey`
   * post-filters by each row's own id and would corrupt `total`/paging; run
   * rows are keyed by run id, grants by configuration/system id), so `access`
   * is deliberately empty and the router enforces the rule via
   * `history-access.ts` (fail-closed).
   */
  getDetailedHistory: proc({
    operationType: "query",
    userType: "authenticated",
    access: [],
  })
    .input(
      z.object({
        systemId: z.string().optional(),
        configurationId: z.string().optional(),
        startDate: z.coerce.date().optional(),
        endDate: z.coerce.date().optional(),
        /** Filter by source: "local" = core only, satellite UUID = specific satellite, undefined = all */
        sourceFilter: z.string().optional(),
        /** Restrict runs to the listed statuses. Omitted/empty = no filter. */
        statusFilter: z.array(HealthCheckStatusSchema).optional(),
        /**
         * Restrict to runs of a single environment (server-side DB filter).
         * `null` → env-less slice; omitted → no env filter (all runs of
         * the (system, configuration)). Same semantics as `getHistory`.
         */
        environmentId: z.string().nullish(),
        limit: z.number().optional().default(10),
        offset: z.number().optional().default(0),
        sortOrder: z.enum(["asc", "desc"]),
      }),
    )
    .output(
      z.object({
        runs: z.array(HealthCheckRunSchema),
        total: z.number(),
      }),
    ),

  /**
   * Single-run detail. AUTHORIZED IN THE HANDLER against the fetched run's
   * OWN configuration/system (so the anchor cannot be spoofed via input):
   * global `configuration.manage`, a team manage grant on the run's
   * configuration, or manage access to the run's system. An unauthorized
   * caller gets the same `undefined` as a missing run - run ids don't leak
   * existence. `access` is deliberately empty; see `history-access.ts`.
   */
  getRunById: proc({
    operationType: "query",
    userType: "authenticated",
    access: [],
  })
    .input(
      z.object({
        runId: z.string(),
      }),
    )
    .output(HealthCheckRunSchema.optional()),

  getAggregatedHistory: proc({
    operationType: "query",
    userType: "public",
    access: [healthCheckAccess.status],
    // Scoped to a specific health-check configuration by its own id.
    instanceAccess: { idParam: "configurationId" },
  })
    .input(
      z.object({
        systemId: z.string(),
        configurationId: z.string(),
        startDate: z.coerce.date(),
        endDate: z.coerce.date(),
        /** Target number of data points (default: 500). Bucket interval is calculated as (endDate - startDate) / targetPoints */
        targetPoints: z.number().min(10).max(2000).default(500),
        /**
         * Restrict to runs / aggregate buckets of a single environment
         * (server-side DB filter across the raw, hourly, and daily tiers
         * the cross-tier aggregation engine reads). `null` → env-less
         * slice; omitted → no env filter (all envs of the (system,
         * configuration)).
         */
        environmentId: z.string().nullish(),
      }),
    )
    .output(
      z.object({
        buckets: z.array(AggregatedBucketBaseSchema),
        /** The calculated bucket interval in seconds */
        bucketIntervalSeconds: z.number(),
      }),
    ),

  /**
   * Detailed per-configuration aggregated history (charts on the history
   * detail page / drawer). AUTHORIZED IN THE HANDLER on the input
   * (`configurationId`, `systemId`) pair - exactly the slice it returns:
   * global `configuration.manage`, a team manage grant on the configuration,
   * or manage access to the system. `authenticated` (was `public`): anonymous
   * callers can never hold any of those, so a public userType only produced
   * guaranteed-403 attempts. `access` is deliberately empty; see
   * `history-access.ts`.
   */
  getDetailedAggregatedHistory: proc({
    operationType: "query",
    userType: "authenticated",
    access: [],
  })
    .input(
      z.object({
        systemId: z.string(),
        configurationId: z.string(),
        startDate: z.coerce.date(),
        endDate: z.coerce.date(),
        /** Filter by source: "local" = core only, satellite UUID = specific satellite, undefined = all */
        sourceFilter: z.string().optional(),
        /** Target number of data points (default: 500). Bucket interval is calculated as (endDate - startDate) / targetPoints */
        targetPoints: z.number().min(10).max(2000).default(500),
        /**
         * Restrict to runs / aggregate buckets of a single environment
         * (server-side DB filter; same semantics as
         * `getAggregatedHistory`).
         */
        environmentId: z.string().nullish(),
      }),
    )
    .output(
      z.object({
        buckets: z.array(AggregatedBucketSchema),
        /** The calculated bucket interval in seconds */
        bucketIntervalSeconds: z.number(),
      }),
    ),

  getSystemHealthStatus: proc({
    operationType: "query",
    userType: "public",
    access: [healthCheckAccess.status],
    // Per-system status read scoped to the catalog system.
    instanceAccess: { parentScope: { resourceType: "catalog.system", action: "read", idParam: "systemId" } },
  })
    .input(z.object({ systemId: z.string() }))
    .output(SystemHealthStatusResponseSchema),

  getBulkSystemHealthStatus: proc({
    operationType: "query",
    userType: "public",
    access: [healthCheckAccess.status],
    instanceAccess: { recordKey: "statuses" },
  })
    .route({ method: "POST" })
    .input(z.object({ systemIds: z.array(z.string()) }))
    .output(
      z.object({
        statuses: z.record(z.string(), SystemHealthStatusResponseSchema),
      }),
    ),

  getBulkSystemHealthMatrix: proc({
    operationType: "query",
    userType: "public",
    access: [healthCheckAccess.status],
    instanceAccess: { recordKey: "statuses" },
  })
    .route({ method: "POST" })
    .input(z.object({ systemIds: z.array(z.string()) }))
    .output(
      z.object({
        /**
         * Per-(system, check, environment) health, keyed by systemId. Consumers
         * that need to scope by environment (e.g. the dependency map) read the
         * per-environment slices here rather than the cross-env rollup, since
         * the rollup deliberately hides a single failing environment.
         */
        statuses: z.record(
          z.string(),
          z.object({
            /** Cross-environment rollup (same as getSystemHealthStatus). */
            status: HealthCheckStatusSchema,
            /** Cross-environment per-check statuses. */
            checkStatuses: z.array(SystemCheckStatusSchema),
            /**
             * Per-environment slices, keyed by environment id (real ids only;
             * the env-less slice is folded into the rollup). Each carries that
             * environment's own rollup status and per-check statuses.
             */
            environments: z.record(
              z.string(),
              z.object({
                status: HealthCheckStatusSchema,
                checkStatuses: z.array(SystemCheckStatusSchema),
              }),
            ),
          }),
        ),
      }),
    ),

  getSystemHealthOverview: proc({
    operationType: "query",
    userType: "public",
    access: [healthCheckAccess.status],
    // Per-system overview scoped to the catalog system.
    instanceAccess: { parentScope: { resourceType: "catalog.system", action: "read", idParam: "systemId" } },
  })
    .input(z.object({ systemId: z.string() }))
    .output(
      z.object({
        systemId: z.string(),
        checks: z.array(
          z.object({
            configurationId: z.string(),
            configurationName: z.string(),
            strategyId: z.string(),
            intervalSeconds: z.number(),
            enabled: z.boolean(),
            /**
             * Whether the configuration is paused (execution skipped). The
             * frontend renders a "Paused" pill for paused checks instead of
             * the run-evaluated `status`, since a paused check's stale runs
             * are not a meaningful current verdict. Paused checks also do
             * not contribute to the system's rollup health (see
             * `getSystemHealthStatus`).
             */
            paused: z.boolean(),
            /**
             * Worst-wins across environments within this assignment (mirrors
             * `getSystemHealthStatus`'s rollup derivation). For an
             * assignment with a single env (or only env-less runs) this
             * equals the per-env status. Frontends that want per-env rows
             * render `perEnvironment` instead.
             */
            status: HealthCheckStatusSchema,
            stateThresholds: StateThresholdsSchema.optional(),
            /**
             * The per-assignment environment selector (`systemHealthChecks.
             * environmentIds`): `null` = all current environments, `[]` = opt
             * out (env-less), a non-empty array = exactly those ids. Surfaced so
             * the frontend orphan detection can tuck a slice whose environment
             * was DISABLED for this assignment under "Old checks" - system
             * membership alone can't tell, since the env is still in the system.
             */
            environmentIds: z.array(z.string()).nullable(),
            /**
             * Timestamp of the most recent HEALTHY run across every environment
             * of this assignment, or `undefined` when the check has never had a
             * successful run. Computed independently of the (bounded) sparkline
             * window, so it stays accurate even when a check has been failing
             * for far longer than `recentRuns` covers — letting the UI show
             * "healthy until <time>" / "failing since <time>" at a glance.
             */
            lastSuccessfulRunAt: z.date().optional(),
            /**
             * Recent runs across all environments of this assignment, newest
             * first then chronologically reversed for sparkline display
             * (preserves the pre-multi-env contract;_safe_ for single-env
             * checks). Carry `environmentId` so a per-env UI can split later.
             */
            recentRuns: z.array(
              z.object({
                id: z.string(),
                status: HealthCheckStatusSchema,
                timestamp: z.date(),
                /**
                 * The environment this run targeted, or `null` for the
                 * env-less slice (opt-out / no-membership). The granularity
                 * the UI can group on if it wants per-(check, env) rows.
                 */
                environmentId: z.string().nullable(),
              }),
            ),
            /**
             * Per-environment breakdown of this assignment, one entry per
             * environment the assignment fans out to (plus a `null` entry if
             * env-less runs exist). Each carries its own rollup `status` and
             * the env-scoped recent runs. A frontend can use this to render
             * a row per (check, environment) pair — surfacing per-env outages
             * that `status` (the worst-wins rollup) intentionally hides in
             * the aggregate view.
             */
            perEnvironment: z.array(
              z.object({
                environmentId: z.string().nullable(),
                status: HealthCheckStatusSchema,
                /**
                 * Most recent HEALTHY run for THIS environment slice, or
                 * `undefined` when this environment has never succeeded.
                 * Computed independently of the sparkline window so a per-env
                 * row can show since when that specific environment degraded.
                 */
                lastSuccessfulRunAt: z.date().optional(),
                recentRuns: z.array(
                  z.object({
                    id: z.string(),
                    status: HealthCheckStatusSchema,
                    timestamp: z.date(),
                  }),
                ),
              }),
            ),
          }),
        ),
      }),
    ),

  // ==========================================================================
  // SERVICE INTERFACE (userType: "service" — backend-to-backend only)
  // Used by satellite-backend to fetch assignments and submit results.
  // ==========================================================================

  getAssignmentsForSatellite: proc({
    operationType: "query",
    userType: "service",
    access: [],
  })
    .input(z.object({ satelliteId: z.string() }))
    .output(
      z.array(
        z.object({
          configId: z.string(),
          systemId: z.string(),
          strategyId: z.string(),
          config: z.record(z.string(), z.unknown()),
          collectors: z
            .array(
              z.object({
                id: z.string(),
                collectorId: z.string(),
                config: z.record(z.string(), z.unknown()),
                assertions: z
                  .array(
                    z.object({
                      field: z.string(),
                      jsonPath: z.string().optional(),
                      operator: z.string(),
                      value: z.unknown().optional(),
                    }),
                  )
                  .optional(),
              }),
            )
            .optional(),
          intervalSeconds: z.number(),
          configName: z.string().optional(),
          systemName: z.string().optional(),
        }),
      ),
    ),

  ingestSatelliteResult: proc({
    operationType: "mutation",
    userType: "service",
    access: [],
  })
    .input(
      z.object({
        configId: z.string(),
        systemId: z.string(),
        status: HealthCheckStatusSchema,
        latencyMs: z.number().optional(),
        result: HealthCheckRunResultSchema.optional(),
        executedAt: z.string(),
        sourceId: z.string(),
        sourceLabel: z.string(),
      }),
    )
    .output(z.void()),

  /**
   * Live health-state snapshot for a single system (Wave-2 sensing
   * contract). Returns status, in-status duration, latency, windowed
   * metrics, and suppression-agnostic maintenance state.
   */
  getHealthState: proc({
    operationType: "query",
    userType: "service",
    access: [],
  })
    .input(
      z.object({
        systemId: z.string(),
        configurationId: z.string().optional(),
        /** Trailing window (minutes) for `transitionsInWindow`. Default 60. */
        transitionWindowMinutes: z.number().int().min(1).optional(),
      }),
    )
    .output(HealthStateSchema),

  /**
   * Bulk variant of {@link getHealthState}. POST to avoid N+1 from
   * dashboards and multi-system automation rules; all systems share one
   * evaluation timestamp.
   */
  getBulkHealthState: proc({
    operationType: "query",
    userType: "service",
    access: [],
  })
    .route({ method: "POST" })
    .input(
      z.object({
        systemIds: z.array(z.string()),
        /** Trailing window (minutes) for `transitionsInWindow`. Default 60. */
        transitionWindowMinutes: z.number().int().min(1).optional(),
      }),
    )
    .output(z.object({ states: z.record(z.string(), HealthStateSchema) })),

  getRunsForAnalysis: proc({
    operationType: "query",
    userType: "service",
    access: [],
  })
    .input(
      z.object({
        startDate: z.coerce.date(),
        limitPerAssignment: z.number().optional().default(200),
      }),
    )
    .output(
      z.array(
        z.object({
          systemId: z.string(),
          configurationId: z.string(),
          runs: z.array(
            z.object({
              result: z.record(z.string(), z.unknown()).nullable().optional(),
              /**
               * Environment the run was executed for. null = env-less slice
               * (no environment membership), mirrored from
               * `health_check_runs.environment_id`. Consumed by the anomaly
               * baseline analyzer to fan out per-env stats.
               */
              environmentId: z.string().nullable(),
            }),
          ),
        }),
      ),
    ),
};
// Export contract type
export type HealthCheckContract = typeof healthCheckContract;

// Export client definition for type-safe forPlugin usage
// Use: const client = rpcApi.forPlugin(HealthCheckApi);
export const HealthCheckApi = createClientDefinition(
  healthCheckContract,
  pluginMetadata,
);
