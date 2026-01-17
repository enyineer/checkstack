import { z } from "zod";

/**
 * Maintenance status enum values
 */
export const MaintenanceStatusEnum = z.enum([
  "scheduled",
  "in_progress",
  "completed",
  "cancelled",
]);
export type MaintenanceStatus = z.infer<typeof MaintenanceStatusEnum>;

/**
 * Core maintenance entity schema
 */
export const MaintenanceSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().optional(),
  suppressNotifications: z.boolean(),
  status: MaintenanceStatusEnum,
  startAt: z.date(),
  endAt: z.date(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type Maintenance = z.infer<typeof MaintenanceSchema>;

/**
 * Maintenance with related systems
 */
export const MaintenanceWithSystemsSchema = MaintenanceSchema.extend({
  systemIds: z.array(z.string()),
});
export type MaintenanceWithSystems = z.infer<
  typeof MaintenanceWithSystemsSchema
>;

/**
 * Maintenance update schema - status updates posted to a maintenance
 */
export const MaintenanceUpdateSchema = z.object({
  id: z.string(),
  maintenanceId: z.string(),
  message: z.string(),
  statusChange: MaintenanceStatusEnum.optional(),
  createdAt: z.date(),
  createdBy: z.string().optional(),
});
export type MaintenanceUpdate = z.infer<typeof MaintenanceUpdateSchema>;

/**
 * Full maintenance detail with systems and updates
 */
export const MaintenanceDetailSchema = MaintenanceWithSystemsSchema.extend({
  updates: z.array(MaintenanceUpdateSchema),
});
export type MaintenanceDetail = z.infer<typeof MaintenanceDetailSchema>;

// Input schemas for mutations
export const CreateMaintenanceInputSchema = z
  .object({
    title: z.string().min(1, "Title is required"),
    description: z.string().optional(),
    suppressNotifications: z.boolean().optional().default(false),
    startAt: z.date(),
    endAt: z.date(),
    systemIds: z.array(z.string()).min(1, "At least one system is required"),
  })
  .refine((data) => data.endAt > data.startAt, {
    message: "End date must be after start date",
    path: ["endAt"],
  });
export type CreateMaintenanceInput = z.infer<
  typeof CreateMaintenanceInputSchema
>;

export const UpdateMaintenanceInputSchema = z.object({
  id: z.string(),
  title: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  suppressNotifications: z.boolean().optional(),
  startAt: z.date().optional(),
  endAt: z.date().optional(),
  systemIds: z.array(z.string()).min(1).optional(),
});
export type UpdateMaintenanceInput = z.infer<
  typeof UpdateMaintenanceInputSchema
>;

export const AddMaintenanceUpdateInputSchema = z.object({
  maintenanceId: z.string(),
  message: z.string().min(1, "Message is required"),
  statusChange: MaintenanceStatusEnum.optional(),
});
export type AddMaintenanceUpdateInput = z.infer<
  typeof AddMaintenanceUpdateInputSchema
>;
