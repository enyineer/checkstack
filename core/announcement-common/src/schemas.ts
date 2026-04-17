import { z } from "zod";

/**
 * Announcement severity determines the visual styling of the announcement.
 * - info: Blue/primary accent — general information
 * - warning: Amber — important notice
 * - critical: Red/destructive — urgent alert
 */
export const AnnouncementSeverityEnum = z.enum(["info", "warning", "critical"]);
export type AnnouncementSeverity = z.infer<typeof AnnouncementSeverityEnum>;

/**
 * Controls who can see the announcement.
 * - all: Everyone, including unauthenticated visitors
 * - authenticated: Only logged-in users
 */
export const AnnouncementVisibilityEnum = z.enum(["all", "authenticated"]);
export type AnnouncementVisibility = z.infer<typeof AnnouncementVisibilityEnum>;

/**
 * Controls where the announcement is displayed.
 * - banner: Global strip above the navbar on every page
 * - dashboard: Card in the dashboard Overview section
 * - both: Displayed in both locations
 */
export const AnnouncementDisplayModeEnum = z.enum([
  "banner",
  "dashboard",
  "both",
]);
export type AnnouncementDisplayMode = z.infer<
  typeof AnnouncementDisplayModeEnum
>;

/**
 * Core announcement entity schema.
 */
export const AnnouncementSchema = z.object({
  id: z.string(),
  title: z.string(),
  message: z.string(),
  severity: AnnouncementSeverityEnum,
  visibility: AnnouncementVisibilityEnum,
  displayMode: AnnouncementDisplayModeEnum,
  active: z.boolean(),
  startsAt: z.date().optional(),
  expiresAt: z.date().optional(),
  createdBy: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type Announcement = z.infer<typeof AnnouncementSchema>;

/**
 * Input schema for creating an announcement.
 */
export const CreateAnnouncementInputSchema = z.object({
  title: z.string().min(1, "Title is required"),
  message: z.string().min(1, "Message is required"),
  severity: AnnouncementSeverityEnum,
  visibility: AnnouncementVisibilityEnum,
  displayMode: AnnouncementDisplayModeEnum,
  active: z.boolean().optional().default(true),
  startsAt: z.date().optional(),
  expiresAt: z.date().optional(),
});
export type CreateAnnouncementInput = z.infer<
  typeof CreateAnnouncementInputSchema
>;

/**
 * Input schema for updating an announcement.
 */
export const UpdateAnnouncementInputSchema = z.object({
  id: z.string(),
  title: z.string().min(1).optional(),
  message: z.string().min(1).optional(),
  severity: AnnouncementSeverityEnum.optional(),
  visibility: AnnouncementVisibilityEnum.optional(),
  displayMode: AnnouncementDisplayModeEnum.optional(),
  active: z.boolean().optional(),
  startsAt: z.date().optional(),
  expiresAt: z.date().optional(),
});
export type UpdateAnnouncementInput = z.infer<
  typeof UpdateAnnouncementInputSchema
>;
