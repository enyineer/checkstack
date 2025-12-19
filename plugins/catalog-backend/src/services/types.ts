import * as schema from "../schema";
import { z } from "zod";

// Systems
export const selectSystemSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  owner: z.string().nullable(),
  metadata: z.record(z.any()).nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export const insertSystemSchema = selectSystemSchema
  .pick({ id: true, name: true })
  .extend({
    description: z.string().optional(),
    owner: z.string().optional(),
    metadata: z.record(z.any()).optional(),
  });
export type System = z.infer<typeof selectSystemSchema>;
export type NewSystem = z.infer<typeof insertSystemSchema>;

// Groups
export const selectGroupSchema = z.object({
  id: z.string(),
  name: z.string(),
  systemId: z.string(),
  metadata: z.record(z.any()).nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export const insertGroupSchema = selectGroupSchema
  .pick({ id: true, name: true, systemId: true })
  .extend({
    metadata: z.record(z.any()).optional(),
  });
export type Group = z.infer<typeof selectGroupSchema>;
export type NewGroup = z.infer<typeof insertGroupSchema>;

// Views
export const selectViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  configuration: z.any(), // JSON
  createdAt: z.date(),
  updatedAt: z.date(),
});
export const insertViewSchema = selectViewSchema
  .pick({ id: true, name: true })
  .extend({
    description: z.string().optional(),
    configuration: z.any().optional(),
  });
export type View = z.infer<typeof selectViewSchema>;
export type NewView = z.infer<typeof insertViewSchema>;

// Incidents
export const selectIncidentSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  status: z.string(),
  severity: z.string(),
  systemId: z.string().nullable(),
  groupId: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export const insertIncidentSchema = selectIncidentSchema
  .pick({ id: true, title: true, status: true, severity: true })
  .extend({
    description: z.string().optional(),
    systemId: z.string().optional().nullable(),
    groupId: z.string().optional().nullable(),
  });
export type Incident = z.infer<typeof selectIncidentSchema>;
export type NewIncident = z.infer<typeof insertIncidentSchema>;

// Maintenances
export const selectMaintenanceSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  status: z.string(),
  startAt: z.date(), // Date strings usually
  endAt: z.date(),
  systemId: z.string().nullable(),
  groupId: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export const insertMaintenanceSchema = selectMaintenanceSchema
  .pick({ id: true, title: true, status: true })
  .extend({
    description: z.string().optional(),
    startAt: z.coerce.date(),
    endAt: z.coerce.date(),
    systemId: z.string().optional().nullable(),
    groupId: z.string().optional().nullable(),
  });
export type Maintenance = z.infer<typeof selectMaintenanceSchema>;
export type NewMaintenance = z.infer<typeof insertMaintenanceSchema>;
