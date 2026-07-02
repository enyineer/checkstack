import { createClientDefinition, proc } from "@checkstack/common";
import { z } from "zod";
import { pluginMetadata } from "./plugin-metadata";
import { AnomalyStateSchema, AnomalySettingsSchema, PartialAnomalySettingsSchema, AnomalyKindSchema } from "./schema";
import { anomalyAccess } from "./access";

export const AnomalyDtoSchema = z.object({
  id: z.string(),
  systemId: z.string(),
  configurationId: z.string(),
  /**
   * Environment this anomaly was detected for. null = the env-less slice (no
   * environment membership). Part of the anomaly's identity: an anomaly for a
   * check in environment A is a distinct row from the same check in environment
   * B. Surfaced so the frontend can render an environment pill and disambiguate
   * two envs of the same field.
   */
  environmentId: z.string().nullable(),
  fieldPath: z.string(),
  kind: AnomalyKindSchema,
  state: AnomalyStateSchema,
  direction: z.enum(["above", "below", "changed"]),
  baselineValue: z.number().nullable(),
  baselineStdDev: z.number().nullable(),
  observedValue: z.string(),
  deviation: z.number(),
  suspiciousRunCount: z.number(),
  confirmationThreshold: z.number(),
  startedAt: z.string(),
  confirmedAt: z.string().nullable(),
  recoveredAt: z.string().nullable(),
  suppressedAt: z.string().nullable(),
  suppressedValue: z.number().nullable(),
  suppressedBaseline: z.number().nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
});

export type AnomalyDto = z.infer<typeof AnomalyDtoSchema>;

export const AnomalyBaselineDtoSchema = z.object({
  id: z.string(),
  systemId: z.string(),
  configurationId: z.string(),
  /**
   * Environment this baseline was computed for. null = the env-less slice (no
   * environment membership). Surfaced so the frontend can keep the env-scoped
   * drawer's chart on the clicked env's baseline only.
   */
  environmentId: z.string().nullable(),
  fieldPath: z.string(),
  mean: z.number(),
  stdDev: z.number(),
  trendSlope: z.number(),
  sampleCount: z.number(),
  computedAt: z.string(),
  dominantValue: z.string().nullable(),
  dominantRatio: z.number().nullable(),
});

export type AnomalyBaselineDto = z.infer<typeof AnomalyBaselineDtoSchema>;

/**
 * A user-scoped mute on anomaly notifications. Empty `fieldPath` means the
 * entire system is muted; non-empty means just that one field.
 */
export const AnomalyNotificationMuteDtoSchema = z.object({
  systemId: z.string(),
  fieldPath: z.string(),
  mutedAt: z.string(),
});

export type AnomalyNotificationMuteDto = z.infer<
  typeof AnomalyNotificationMuteDtoSchema
>;

/**
 * Schema for a VersionedRecord wrapper used in RPC transport.
 * Wraps the data with version metadata for backward-compatible schema evolution.
 */
const VersionedAnomalySettingsSchema = z.object({
  version: z.number(),
  data: AnomalySettingsSchema,
  migratedAt: z.date().optional(),
  originalVersion: z.number().optional(),
});

const VersionedPartialAnomalySettingsSchema = z.object({
  version: z.number(),
  data: PartialAnomalySettingsSchema,
  migratedAt: z.date().optional(),
  originalVersion: z.number().optional(),
});

export const anomalyContract = {
  getAnomalies: proc({
    operationType: "query",
    userType: "public",
    access: [anomalyAccess.feed.read],
    instanceAccess: { idParam: "systemId" },
  })
    .input(z.object({
      systemId: z.string().optional(),
      configurationId: z.string().optional(),
      /**
       * Optional environment filter, mirroring `getAnomalyBaselines`:
       * - `undefined` (omitted) -> anomalies for ALL environments (the widget's
       *   cross-env feed, or any caller that isn't env-scoped).
       * - `null` -> only the env-less slice (environment_id IS NULL).
       * - a string -> only that environment's anomalies.
       */
      environmentId: z.string().nullish(),
      state: AnomalyStateSchema.optional(),
      kind: AnomalyKindSchema.optional(),
      /**
       * Suppression filter. "active" (default) hides globally-suppressed rows,
       * "suppressed" lists only them, "all" ignores the flag.
       */
      suppression: z.enum(["active", "suppressed", "all"]).optional(),
      limit: z.number().optional().default(50),
    }))
    .output(z.array(AnomalyDtoSchema)),

  getAnomalyBaselines: proc({
    operationType: "query",
    userType: "public",
    access: [anomalyAccess.feed.read],
    instanceAccess: { idParam: "systemId" },
  })
    .input(z.object({
      systemId: z.string(),
      configurationId: z.string(),
      /**
       * Optional environment filter, mirroring the HealthCheckDrawer's
       * `item.environmentId` semantics:
       * - `undefined` (omitted) → return baselines for ALL environments
       *   (the single-env rollup row, or any caller that isn't env-scoped).
       * - `null` → only the env-less slice (environment_id IS NULL).
       * - a string → only that environment's baselines.
       */
      environmentId: z.string().nullish(),
    }))
    .output(z.array(AnomalyBaselineDtoSchema)),

  getAnomalyConfig: proc({
    operationType: "query",
    userType: "authenticated",
    access: [anomalyAccess.feed.manage],
    // Config templates are shared (no systemId in input); no per-system scope possible.
    instanceAccess: { global: true },
  })
    .input(z.object({
      configurationId: z.string(),
    }))
    .output(VersionedAnomalySettingsSchema),

  updateAnomalyConfig: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [anomalyAccess.feed.manage],
    // Config templates are shared (no systemId in input); no per-system scope possible.
    instanceAccess: { global: true },
  })
    .route({ method: "PATCH" })
    .input(z.object({
      configurationId: z.string(),
      config: AnomalySettingsSchema,
    }))
    .output(VersionedAnomalySettingsSchema),

  getAnomalyAssignmentConfig: proc({
    operationType: "query",
    userType: "authenticated",
    access: [anomalyAccess.feed.manage],
    instanceAccess: { idParam: "systemId" },
  })
    .input(z.object({
      systemId: z.string(),
      configurationId: z.string(),
    }))
    .output(VersionedPartialAnomalySettingsSchema.nullable()),

  updateAnomalyAssignmentConfig: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [anomalyAccess.feed.manage],
    instanceAccess: { idParam: "systemId" },
  })
    .route({ method: "PATCH" })
    .input(z.object({
      systemId: z.string(),
      configurationId: z.string(),
      config: PartialAnomalySettingsSchema,
    }))
    .output(VersionedPartialAnomalySettingsSchema),

  /**
   * List all anomaly-notification mutes belonging to the calling user.
   * Optionally filterable by systemId (e.g. when rendering per-system mute
   * controls inside a system detail view).
   */
  listAnomalyNotificationMutes: proc({
    operationType: "query",
    userType: "user",
    access: [],
  })
    .input(
      z.object({
        systemId: z.string().optional(),
      }),
    )
    .output(z.array(AnomalyNotificationMuteDtoSchema)),

  /**
   * Mute anomaly notifications for the calling user. Pass an empty
   * `fieldPath` to mute the entire system; otherwise mutes only the
   * specific field. Idempotent.
   */
  muteAnomalyNotification: proc({
    operationType: "mutation",
    userType: "user",
    access: [],
    instanceAccess: { idParam: "systemId" },
  })
    .input(
      z.object({
        systemId: z.string(),
        fieldPath: z.string().default(""),
      }),
    )
    .output(z.object({ success: z.boolean() })),

  /**
   * Globally suppress an anomaly row so it disappears from the active feed
   * until the metric "changes again". Suppression is per-row (not per-user)
   * and lives in shared Postgres so every pod sees the same active set.
   * Gated by `feed.manage`. Idempotent.
   */
  suppressAnomaly: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [anomalyAccess.feed.manage],
    instanceAccess: { idParam: "systemId" },
  })
    .route({ method: "POST" })
    .input(
      z.object({
        systemId: z.string(),
        anomalyId: z.string(),
      }),
    )
    .output(z.object({ success: z.boolean() })),

  /**
   * Manually clear suppression on an anomaly row, returning it to the active
   * feed. Gated by `feed.manage`. Idempotent.
   */
  unsuppressAnomaly: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [anomalyAccess.feed.manage],
    instanceAccess: { idParam: "systemId" },
  })
    .route({ method: "POST" })
    .input(
      z.object({
        systemId: z.string(),
        anomalyId: z.string(),
      }),
    )
    .output(z.object({ success: z.boolean() })),

  /**
   * Remove a mute previously created via muteAnomalyNotification. No-op if
   * no matching record exists.
   */
  unmuteAnomalyNotification: proc({
    operationType: "mutation",
    userType: "user",
    access: [],
    instanceAccess: { idParam: "systemId" },
  })
    .input(
      z.object({
        systemId: z.string(),
        fieldPath: z.string().default(""),
      }),
    )
    .output(z.object({ success: z.boolean() })),
};

export type AnomalyContract = typeof anomalyContract;

export const AnomalyApi = createClientDefinition(
  anomalyContract,
  pluginMetadata
);
