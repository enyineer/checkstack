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

  /** List all SLO objectives with their computed status */
  listObjectives: proc({
    operationType: "query",
    userType: "public",
    access: [sloAccess.slo.read],
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

  /** Get a single SLO objective with full status and attribution */
  getObjective: proc({
    operationType: "query",
    userType: "public",
    access: [sloAccess.slo.read],
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

  /** Get SLOs for a specific system (for badge display) */
  getObjectivesForSystem: proc({
    operationType: "query",
    userType: "public",
    access: [sloAccess.slo.read],
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

  /** Bulk fetch SLO statuses for multiple systems (dashboard, avoid N+1) */
  getBulkObjectivesForSystems: proc({
    operationType: "query",
    userType: "public",
    access: [sloAccess.slo.read],
    instanceAccess: { recordKey: "systems" },
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

  /** Create a new SLO objective */
  createObjective: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [sloAccess.slo.manage],
  })
    .input(CreateSloObjectiveInputSchema)
    .output(SloObjectiveSchema),

  /** Update an existing SLO objective */
  updateObjective: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [sloAccess.slo.manage],
  })
    .route({ method: "PATCH" })
    .input(UpdateSloObjectiveInputSchema)
    .output(SloObjectiveSchema),

  /** Delete an SLO objective and all associated data */
  deleteObjective: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [sloAccess.slo.manage],
  })
    .route({ method: "DELETE" })
    .input(z.object({ id: z.string() }))
    .output(z.object({ success: z.boolean() })),

  // ==========================================================================
  // DOWNTIME EVENTS & DAILY SNAPSHOTS
  // ==========================================================================

  /** Get recent downtime events for an SLO objective */
  getDowntimeEvents: proc({
    operationType: "query",
    userType: "public",
    access: [sloAccess.slo.read],
  })
    .input(
      z.object({
        objectiveId: z.string(),
        limit: z.number().optional().default(50),
      }),
    )
    .output(z.object({ events: z.array(SloDowntimeEventSchema) })),

  /** Get daily SLO trend data for a time range */
  getDailySnapshots: proc({
    operationType: "query",
    userType: "public",
    access: [sloAccess.slo.read],
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

  /** Get streaks for all SLO objectives */
  getStreaks: proc({
    operationType: "query",
    userType: "public",
    access: [sloAccess.slo.read],
  }).output(z.object({ streaks: z.array(SloStreakSchema) })),

  /** Get achievements for a specific system */
  getAchievements: proc({
    operationType: "query",
    userType: "public",
    access: [sloAccess.slo.read],
  })
    .input(z.object({ systemId: z.string() }))
    .output(z.object({ achievements: z.array(SloAchievementSchema) })),

  /** Get recent milestones across all systems (for milestone feed) */
  getRecentMilestones: proc({
    operationType: "query",
    userType: "public",
    access: [sloAccess.slo.read],
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
