import { z } from "zod";

/**
 * Incident status enum values.
 * Represents the lifecycle stages of an incident.
 */
export const IncidentStatusEnum = z.enum([
  "investigating",
  "identified",
  "fixing",
  "monitoring",
  "resolved",
]);
export type IncidentStatus = z.infer<typeof IncidentStatusEnum>;

/**
 * Incident severity enum values.
 * Represents the impact level of an incident.
 */
export const IncidentSeverityEnum = z.enum(["minor", "major", "critical"]);
export type IncidentSeverity = z.infer<typeof IncidentSeverityEnum>;

/**
 * Core incident entity schema
 */
export const IncidentSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().optional(),
  status: IncidentStatusEnum,
  severity: IncidentSeverityEnum,
  suppressNotifications: z.boolean(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type Incident = z.infer<typeof IncidentSchema>;

/**
 * Incident with related systems
 */
export const IncidentWithSystemsSchema = IncidentSchema.extend({
  systemIds: z.array(z.string()),
});
export type IncidentWithSystems = z.infer<typeof IncidentWithSystemsSchema>;

/**
 * Incident update schema - status updates posted to an incident
 */
export const IncidentUpdateSchema = z.object({
  id: z.string(),
  incidentId: z.string(),
  message: z.string(),
  statusChange: IncidentStatusEnum.optional(),
  createdAt: z.date(),
  createdBy: z.string().optional(),
  createdByName: z.string().optional(),
});
export type IncidentUpdate = z.infer<typeof IncidentUpdateSchema>;

/**
 * Free-form hotlink attached to an incident (e.g. Jira ticket, runbook).
 */
export const IncidentLinkSchema = z.object({
  id: z.string(),
  incidentId: z.string(),
  label: z.string().nullable(),
  url: z.string(),
  createdAt: z.date(),
});
export type IncidentLink = z.infer<typeof IncidentLinkSchema>;

export const AddIncidentLinkInputSchema = z.object({
  incidentId: z.string(),
  label: z.string().max(120).optional(),
  url: z.string().url("Must be a valid URL"),
});
export type AddIncidentLinkInput = z.infer<typeof AddIncidentLinkInputSchema>;

/**
 * Full incident detail with systems, updates, and hotlinks
 */
export const IncidentDetailSchema = IncidentWithSystemsSchema.extend({
  updates: z.array(IncidentUpdateSchema),
  links: z.array(IncidentLinkSchema),
});
export type IncidentDetail = z.infer<typeof IncidentDetailSchema>;

// Input schemas for mutations
export const CreateIncidentInputSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().optional(),
  severity: IncidentSeverityEnum,
  suppressNotifications: z.boolean().optional().default(false),
  systemIds: z.array(z.string()).min(1, "At least one system is required"),
  initialMessage: z
    .string()
    .optional()
    .describe("Optional initial status update message"),
});
export type CreateIncidentInput = z.infer<typeof CreateIncidentInputSchema>;

export const UpdateIncidentInputSchema = z.object({
  id: z.string(),
  title: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  severity: IncidentSeverityEnum.optional(),
  suppressNotifications: z.boolean().optional(),
  systemIds: z.array(z.string()).min(1).optional(),
});
export type UpdateIncidentInput = z.infer<typeof UpdateIncidentInputSchema>;

export const AddIncidentUpdateInputSchema = z.object({
  incidentId: z.string(),
  message: z.string().min(1, "Message is required"),
  statusChange: IncidentStatusEnum.optional(),
});
export type AddIncidentUpdateInput = z.infer<
  typeof AddIncidentUpdateInputSchema
>;
