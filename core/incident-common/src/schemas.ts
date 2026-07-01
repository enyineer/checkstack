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
  /**
   * Optional owning-team id. When supplied by an authenticated team member, the
   * autoAuthMiddleware create-mode writes a team-scoped ownership grant for the
   * newly created incident. Omitting it (or calling with global-manage) creates
   * the incident without team scoping, exactly as before. Never written to the
   * incident row — the router handler ignores this field before delegating to
   * the service.
   */
  teamId: z.string().optional(),
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

/**
 * Per-id outcome of a bulk incident action (mass delete / mass resolve).
 *
 * - `deleted` / `resolved`: the action succeeded for this incident.
 * - `notFound`: no incident with this id exists (or it vanished mid-batch).
 * - `forbidden`: the caller cannot MANAGE this incident (filtered out by the
 *   `bulkManage` instance-access mode before the handler ran).
 * - `error`: the per-id operation threw; the batch continued past it.
 */
export const BulkIncidentActionStatusEnum = z.enum([
  "deleted",
  "resolved",
  "notFound",
  "forbidden",
  "error",
]);
export type BulkIncidentActionStatus = z.infer<
  typeof BulkIncidentActionStatusEnum
>;

export const BulkIncidentActionResultSchema = z.object({
  id: z.string(),
  status: BulkIncidentActionStatusEnum,
});
export type BulkIncidentActionResult = z.infer<
  typeof BulkIncidentActionResultSchema
>;

/** Input for a bulk incident action: a non-empty set of incident ids. */
export const BulkIncidentIdsInputSchema = z.object({
  ids: z.array(z.string()).min(1, "At least one incident is required"),
});
export type BulkIncidentIdsInput = z.infer<typeof BulkIncidentIdsInputSchema>;

/** Input for bulk resolve: incident ids plus an optional shared message. */
export const BulkResolveIncidentsInputSchema = z.object({
  ids: z.array(z.string()).min(1, "At least one incident is required"),
  message: z.string().optional(),
});
export type BulkResolveIncidentsInput = z.infer<
  typeof BulkResolveIncidentsInputSchema
>;
