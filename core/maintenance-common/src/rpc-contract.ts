import { z } from "zod";
import { createClientDefinition, proc } from "@checkstack/common";
import { maintenanceAccess } from "./access";
import { pluginMetadata } from "./plugin-metadata";
import {
  MaintenanceWithSystemsSchema,
  MaintenanceDetailSchema,
  MaintenanceUpdateSchema,
  MaintenanceLinkSchema,
  AddMaintenanceLinkInputSchema,
  CreateMaintenanceInputSchema,
  UpdateMaintenanceInputSchema,
  AddMaintenanceUpdateInputSchema,
  MaintenanceStatusEnum,
} from "./schemas";

export const maintenanceContract = {
  /** List all maintenances with optional status filter */
  listMaintenances: proc({
    operationType: "query",
    userType: "public",
    access: [maintenanceAccess.maintenance.read],
  })
    .input(
      z
        .object({
          status: MaintenanceStatusEnum.optional(),
          systemId: z.string().optional(),
        })
        .optional(),
    )
    .output(z.object({ maintenances: z.array(MaintenanceWithSystemsSchema) })),

  /** Get a single maintenance with all details */
  getMaintenance: proc({
    operationType: "query",
    userType: "public",
    access: [maintenanceAccess.maintenance.read],
  })
    .input(z.object({ id: z.string() }))
    .output(MaintenanceDetailSchema.nullable()),

  /** Get active or upcoming maintenances for a specific system */
  getMaintenancesForSystem: proc({
    operationType: "query",
    userType: "public",
    access: [maintenanceAccess.maintenance.read],
  })
    .input(z.object({ systemId: z.string() }))
    .output(z.array(MaintenanceWithSystemsSchema)),

  /** Get active maintenances for multiple systems in a single request.
   * Used for efficient dashboard rendering to avoid N+1 queries.
   */
  getBulkMaintenancesForSystems: proc({
    operationType: "query",
    userType: "public",
    access: [maintenanceAccess.maintenance.read],
    instanceAccess: { recordKey: "maintenances" },
  })
    .route({ method: "POST" })
    .input(z.object({ systemIds: z.array(z.string()) }))
    .output(
      z.object({
        maintenances: z.record(
          z.string(),
          z.array(MaintenanceWithSystemsSchema),
        ),
      }),
    ),

  /** Create a new maintenance */
  createMaintenance: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [maintenanceAccess.maintenance.manage],
  })
    .input(CreateMaintenanceInputSchema)
    .output(MaintenanceWithSystemsSchema),

  /** Update an existing maintenance */
  updateMaintenance: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [maintenanceAccess.maintenance.manage],
  })
    .route({ method: "PATCH" })
    .input(UpdateMaintenanceInputSchema)
    .output(MaintenanceWithSystemsSchema),

  /** Add a status update to a maintenance */
  addUpdate: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [maintenanceAccess.maintenance.manage],
  })
    .input(AddMaintenanceUpdateInputSchema)
    .output(MaintenanceUpdateSchema),

  /** Close a maintenance early (sets status to completed) */
  closeMaintenance: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [maintenanceAccess.maintenance.manage],
  })
    .input(z.object({ id: z.string(), message: z.string().optional() }))
    .output(MaintenanceWithSystemsSchema),

  /** Add a hotlink (e.g. change ticket, runbook) to a maintenance */
  addLink: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [maintenanceAccess.maintenance.manage],
  })
    .input(AddMaintenanceLinkInputSchema)
    .output(MaintenanceLinkSchema),

  /** Remove a hotlink from a maintenance */
  removeLink: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [maintenanceAccess.maintenance.manage],
  })
    .route({ method: "DELETE" })
    .input(z.object({ id: z.string() }))
    .output(z.object({ success: z.boolean() })),

  /** Delete a maintenance */
  deleteMaintenance: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [maintenanceAccess.maintenance.manage],
  })
    .route({ method: "DELETE" })
    .input(z.object({ id: z.string() }))
    .output(z.object({ success: z.boolean() })),

  /** Check if a system has active maintenance with notification suppression enabled.
   * Used by healthcheck to skip notifications during expected downtime.
   * Service-to-service endpoint (not exposed to users).
   */
  hasActiveMaintenanceWithSuppression: proc({
    operationType: "query",
    userType: "service",
    access: [],
  })
    .input(z.object({ systemId: z.string() }))
    .output(z.object({ suppressed: z.boolean() })),

  /** Check if a system currently has an active maintenance window,
   * regardless of notification-suppression. Used by automations and the
   * health-state provider to gate on maintenance state without coupling
   * to the suppression flag. Service-to-service endpoint.
   */
  hasActiveMaintenance: proc({
    operationType: "query",
    userType: "service",
    access: [],
  })
    .input(z.object({ systemId: z.string() }))
    .output(z.object({ active: z.boolean() })),
};

// Export contract type
export type MaintenanceContract = typeof maintenanceContract;

// Export client definition for type-safe forPlugin usage
// Use: const client = rpcApi.forPlugin(MaintenanceApi);
export const MaintenanceApi = createClientDefinition(
  maintenanceContract,
  pluginMetadata,
);
