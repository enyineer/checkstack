import { z } from "zod";
import { createClientDefinition, proc } from "@checkstack/common";
import { sloAccess } from "./access";
import { pluginMetadata } from "./plugin-metadata";
import {
  SloObjectiveSchema,
  SloStatusSchema,
  SloDowntimeEventSchema,
  SloDailySnapshotSchema,
  SloStreakSchema,
  SloAchievementSchema,
  CreateSloObjectiveInputSchema,
  UpdateSloObjectiveInputSchema,
} from "./schemas";

export const sloContract = {
  // ==========================================================================
  // SLO OBJECTIVE MANAGEMENT
  // ==========================================================================

  /**
   * List all SLO objectives with their computed status.
   *
   * Items are `{ objective, status }` — no top-level `.id`, so `listKey`
   * cannot be used. Per-objective gates are enforced by getObjective /
   * updateObjective / deleteObjective; this list endpoint is global.
   */
  listObjectives: proc({
    operationType: "query",
    userType: "public",
    access: [sloAccess.slo.read],
    instanceAccess: { global: true }, // items lack top-level .id; listKey not applicable
  }).output(
    z.object({
      objectives: z.array(
        z.object({
          objective: SloObjectiveSchema,
          status: SloStatusSchema,
        }),
      ),
    }),
  ),

  /**
   * Get a single SLO objective with full status and attribution.
   * Grants are keyed by objective id (`resourceType="slo.slo"`,
   * `resourceId={objective.id}`). The `id` input field matches that
   * resourceId directly, so `idParam: "id"` is correct.
   */
  getObjective: proc({
    operationType: "query",
    userType: "public",
    access: [sloAccess.slo.read],
    instanceAccess: { idParam: "id" },
  })
    .input(z.object({ id: z.string() }))
    .output(
      z
        .object({
          objective: SloObjectiveSchema,
          status: SloStatusSchema,
        })
        .nullable(),
    ),

  /**
   * Get SLOs for a specific system (for badge display).
   * Scoped via the catalog.system parent grant keyed by `systemId`.
   */
  getObjectivesForSystem: proc({
    operationType: "query",
    userType: "public",
    access: [sloAccess.slo.read],
    instanceAccess: { parentScope: { resourceType: "catalog.system", action: "read", idParam: "systemId" } }, // scoped to a single system
  })
    .input(z.object({ systemId: z.string() }))
    .output(
      z.array(
        z.object({
          objective: SloObjectiveSchema,
          status: SloStatusSchema,
        }),
      ),
    ),

  /**
   * Bulk fetch SLO statuses for multiple systems (dashboard, avoid N+1).
   * Output `{ systems: Record<systemId, _> }` — scoped via catalog.system
   * parent grants, one entry per system the caller may read.
   */
  getBulkObjectivesForSystems: proc({
    operationType: "query",
    userType: "public",
    access: [sloAccess.slo.read],
    instanceAccess: { parentScope: { resourceType: "catalog.system", action: "read", recordKey: "systems" } }, // record keyed by systemId
  })
    .route({ method: "POST" })
    .input(z.object({ systemIds: z.array(z.string()) }))
    .output(
      z.object({
        systems: z.record(
          z.string(),
          z.array(
            z.object({
              objective: SloObjectiveSchema,
              status: SloStatusSchema,
            }),
          ),
        ),
      }),
    ),

  /**
   * Create a new SLO objective.
   *
   * Opts in to create-mode team ownership: `instanceAccess.create` tells
   * autoAuthMiddleware to (a) honour an optional `teamId` input field as the
   * requested owning team, and (b) write a team-scoped grant for the newly
   * created objective using the `id` returned in the response.
   * Grants are keyed `slo.slo / <objective.id>`, matching the idParam used by
   * getObjective / updateObjective / deleteObjective.
   */
  createObjective: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [sloAccess.slo.manage],
    instanceAccess: { create: { teamIdParam: "teamId", idField: "id" } },
  })
    .input(CreateSloObjectiveInputSchema)
    .output(SloObjectiveSchema),

  /**
   * Update an existing SLO objective.
   * Scoped by the objective's own grant (`idParam: "id"` matches
   * `resourceType="slo.slo"`, `resourceId={objective.id}`).
   */
  updateObjective: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [sloAccess.slo.manage],
    instanceAccess: { idParam: "id" },
  })
    .route({ method: "PATCH" })
    .input(UpdateSloObjectiveInputSchema)
    .output(SloObjectiveSchema),

  /**
   * Delete an SLO objective and all associated data.
   * Scoped by the objective's own grant (`idParam: "id"` matches
   * `resourceType="slo.slo"`, `resourceId={objective.id}`).
   */
  deleteObjective: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [sloAccess.slo.manage],
    instanceAccess: { idParam: "id" },
  })
    .route({ method: "DELETE" })
    .input(z.object({ id: z.string() }))
    .output(z.object({ success: z.boolean() })),

  // ==========================================================================
  // DOWNTIME EVENTS & DAILY SNAPSHOTS
  // ==========================================================================

  /**
   * Get recent downtime events for an SLO objective.
   * Scoped by the objective's own grant (`idParam: "objectiveId"` matches
   * `resourceType="slo.slo"`, `resourceId={objective.id}`).
   */
  getDowntimeEvents: proc({
    operationType: "query",
    userType: "public",
    access: [sloAccess.slo.read],
    instanceAccess: { idParam: "objectiveId" },
  })
    .input(
      z.object({
        objectiveId: z.string(),
        limit: z.number().optional().default(50),
      }),
    )
    .output(z.object({ events: z.array(SloDowntimeEventSchema) })),

  /**
   * Get daily SLO trend data for a time range.
   * Scoped by the objective's own grant (`idParam: "objectiveId"` matches
   * `resourceType="slo.slo"`, `resourceId={objective.id}`).
   */
  getDailySnapshots: proc({
    operationType: "query",
    userType: "public",
    access: [sloAccess.slo.read],
    instanceAccess: { idParam: "objectiveId" },
  })
    .input(
      z.object({
        objectiveId: z.string(),
        startDate: z.coerce.date(),
        endDate: z.coerce.date(),
      }),
    )
    .output(z.object({ snapshots: z.array(SloDailySnapshotSchema) })),

  // ==========================================================================
  // STREAKS & ACHIEVEMENTS
  // ==========================================================================

  /**
   * Get streaks for all SLO objectives.
   * `SloStreak` items carry `objectiveId`/`systemId` but no top-level `.id`,
   * so `listKey` cannot be used. Global until the item shape is updated.
   */
  getStreaks: proc({
    operationType: "query",
    userType: "public",
    access: [sloAccess.slo.read],
    instanceAccess: { global: true }, // items lack top-level .id; listKey not applicable
  }).output(z.object({ streaks: z.array(SloStreakSchema) })),

  /**
   * Get achievements for a specific system.
   * Scoped via the catalog.system parent grant keyed by `systemId`.
   */
  getAchievements: proc({
    operationType: "query",
    userType: "public",
    access: [sloAccess.slo.read],
    instanceAccess: { parentScope: { resourceType: "catalog.system", action: "read", idParam: "systemId" } }, // scoped to a single system
  })
    .input(z.object({ systemId: z.string() }))
    .output(z.object({ achievements: z.array(SloAchievementSchema) })),

  /**
   * Get recent milestones across all systems (for milestone feed).
   * Cross-system aggregate with no per-system input param - global scope.
   */
  getRecentMilestones: proc({
    operationType: "query",
    userType: "public",
    access: [sloAccess.slo.read],
    instanceAccess: { global: true }, // cross-system aggregate; no systemId input to scope on
  })
    .input(z.object({ limit: z.number().optional().default(20) }))
    .output(
      z.object({
        milestones: z.array(
          z.object({
            systemId: z.string(),
            systemName: z.string().optional(),
            achievement: z.string(),
            unlockedAt: z.date(),
          }),
        ),
      }),
    ),
};

export type SloContract = typeof sloContract;

export const SloApi = createClientDefinition(sloContract, pluginMetadata);
