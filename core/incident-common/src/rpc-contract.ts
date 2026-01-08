import { oc } from "@orpc/contract";
import { z } from "zod";
import {
  createClientDefinition,
  type ProcedureMetadata,
} from "@checkmate-monitor/common";
import { permissions } from "./permissions";
import { pluginMetadata } from "./plugin-metadata";
import {
  IncidentWithSystemsSchema,
  IncidentDetailSchema,
  IncidentUpdateSchema,
  CreateIncidentInputSchema,
  UpdateIncidentInputSchema,
  AddIncidentUpdateInputSchema,
  IncidentStatusEnum,
} from "./schemas";

const _base = oc.$meta<ProcedureMetadata>({});

export const incidentContract = {
  /** List all incidents with optional filters */
  listIncidents: _base
    .meta({
      userType: "public",
      permissions: [permissions.incidentRead.id],
    })
    .input(
      z
        .object({
          status: IncidentStatusEnum.optional(),
          systemId: z.string().optional(),
          includeResolved: z.boolean().optional().default(false),
        })
        .optional()
    )
    .output(z.array(IncidentWithSystemsSchema)),

  /** Get a single incident with all details */
  getIncident: _base
    .meta({
      userType: "public",
      permissions: [permissions.incidentRead.id],
    })
    .input(z.object({ id: z.string() }))
    .output(IncidentDetailSchema.nullable()),

  /** Get active incidents for a specific system */
  getIncidentsForSystem: _base
    .meta({
      userType: "public",
      permissions: [permissions.incidentRead.id],
    })
    .input(z.object({ systemId: z.string() }))
    .output(z.array(IncidentWithSystemsSchema)),

  /** Create a new incident */
  createIncident: _base
    .meta({
      userType: "authenticated",
      permissions: [permissions.incidentManage.id],
    })
    .input(CreateIncidentInputSchema)
    .output(IncidentWithSystemsSchema),

  /** Update an existing incident */
  updateIncident: _base
    .meta({
      userType: "authenticated",
      permissions: [permissions.incidentManage.id],
    })
    .input(UpdateIncidentInputSchema)
    .output(IncidentWithSystemsSchema),

  /** Add a status update to an incident */
  addUpdate: _base
    .meta({
      userType: "authenticated",
      permissions: [permissions.incidentManage.id],
    })
    .input(AddIncidentUpdateInputSchema)
    .output(IncidentUpdateSchema),

  /** Resolve an incident (sets status to resolved) */
  resolveIncident: _base
    .meta({
      userType: "authenticated",
      permissions: [permissions.incidentManage.id],
    })
    .input(z.object({ id: z.string(), message: z.string().optional() }))
    .output(IncidentWithSystemsSchema),

  /** Delete an incident */
  deleteIncident: _base
    .meta({
      userType: "authenticated",
      permissions: [permissions.incidentManage.id],
    })
    .input(z.object({ id: z.string() }))
    .output(z.object({ success: z.boolean() })),
};

// Export contract type
export type IncidentContract = typeof incidentContract;

// Export client definition for type-safe forPlugin usage
// Use: const client = rpcApi.forPlugin(IncidentApi);
export const IncidentApi = createClientDefinition(
  incidentContract,
  pluginMetadata
);
