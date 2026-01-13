import { oc } from "@orpc/contract";
import { z } from "zod";
import {
  createClientDefinition,
  type ProcedureMetadata,
} from "@checkstack/common";
import { maintenanceAccess } from "./access";
import { pluginMetadata } from "./plugin-metadata";
import {
  MaintenanceWithSystemsSchema,
  MaintenanceDetailSchema,
  MaintenanceUpdateSchema,
  CreateMaintenanceInputSchema,
  UpdateMaintenanceInputSchema,
  AddMaintenanceUpdateInputSchema,
  MaintenanceStatusEnum,
} from "./schemas";

const _base = oc.$meta<ProcedureMetadata>({});

export const maintenanceContract = {
  /** List all maintenances with optional status filter */
  listMaintenances: _base
    .meta({
      userType: "public",
      access: [maintenanceAccess.maintenance.read],
    })
    .input(
      z
        .object({
          status: MaintenanceStatusEnum.optional(),
          systemId: z.string().optional(),
        })
        .optional()
    )
    .output(z.object({ maintenances: z.array(MaintenanceWithSystemsSchema) })),

  /** Get a single maintenance with all details */
  getMaintenance: _base
    .meta({
      userType: "public",
      access: [maintenanceAccess.maintenance.read],
    })
    .input(z.object({ id: z.string() }))
    .output(MaintenanceDetailSchema.nullable()),

  /** Get active or upcoming maintenances for a specific system */
  getMaintenancesForSystem: _base
    .meta({
      userType: "public",
      access: [maintenanceAccess.maintenance.read],
    })
    .input(z.object({ systemId: z.string() }))
    .output(z.array(MaintenanceWithSystemsSchema)),

  /** Create a new maintenance */
  createMaintenance: _base
    .meta({
      userType: "authenticated",
      access: [maintenanceAccess.maintenance.manage],
    })
    .input(CreateMaintenanceInputSchema)
    .output(MaintenanceWithSystemsSchema),

  /** Update an existing maintenance */
  updateMaintenance: _base
    .meta({
      userType: "authenticated",
      access: [maintenanceAccess.maintenance.manage],
    })
    .input(UpdateMaintenanceInputSchema)
    .output(MaintenanceWithSystemsSchema),

  /** Add a status update to a maintenance */
  addUpdate: _base
    .meta({
      userType: "authenticated",
      access: [maintenanceAccess.maintenance.manage],
    })
    .input(AddMaintenanceUpdateInputSchema)
    .output(MaintenanceUpdateSchema),

  /** Close a maintenance early (sets status to completed) */
  closeMaintenance: _base
    .meta({
      userType: "authenticated",
      access: [maintenanceAccess.maintenance.manage],
    })
    .input(z.object({ id: z.string(), message: z.string().optional() }))
    .output(MaintenanceWithSystemsSchema),

  /** Delete a maintenance */
  deleteMaintenance: _base
    .meta({
      userType: "authenticated",
      access: [maintenanceAccess.maintenance.manage],
    })
    .input(z.object({ id: z.string() }))
    .output(z.object({ success: z.boolean() })),
};

// Export contract type
export type MaintenanceContract = typeof maintenanceContract;

// Export client definition for type-safe forPlugin usage
// Use: const client = rpcApi.forPlugin(MaintenanceApi);
export const MaintenanceApi = createClientDefinition(
  maintenanceContract,
  pluginMetadata
);
