import { z } from "zod";
import { AnnouncementSeverityEnum } from "./schemas";

/**
 * Status-page "Announcements" widget contracts.
 *
 * The status-page platform is GENERAL and must never import this DOMAIN plugin,
 * so the announcement plugin owns both the CONFIG schema (what the builder
 * stores) and the public DTO schema (the field allow-list the public resolver
 * emits). The resolver runs as a TRUSTED principal, so the DTO is the security
 * boundary: it carries only public-safe fields (title / message / severity /
 * timestamps) and deliberately OMITS `id`, `createdBy`, `visibility`, and
 * `displayMode`. It also carries NO `status` enum, so an announcement never
 * rolls up into the page's overall status banner.
 */

/** Local widget id; qualifies to `announcement.announcements` (plugin id + id). */
export const ANNOUNCEMENTS_WIDGET_ID = "announcements";

export const AnnouncementsWidgetConfigSchema = z.object({
  /** Cap the number of announcements shown. */
  limit: z.number().int().min(1).max(20).default(5),
});
export type AnnouncementsWidgetConfig = z.infer<
  typeof AnnouncementsWidgetConfigSchema
>;

/** A single public-safe announcement row (the allow-list). */
export const AnnouncementsWidgetItemDtoSchema = z.object({
  title: z.string(),
  message: z.string(),
  severity: AnnouncementSeverityEnum,
  /** ISO timestamp the announcement became active, when configured. */
  startsAt: z.string().optional(),
  /** ISO creation timestamp (fallback ordering / display date). */
  createdAt: z.string(),
});
export type AnnouncementsWidgetItemDto = z.infer<
  typeof AnnouncementsWidgetItemDtoSchema
>;

export const AnnouncementsWidgetDtoSchema = z.object({
  announcements: z.array(AnnouncementsWidgetItemDtoSchema),
});
export type AnnouncementsWidgetDto = z.infer<
  typeof AnnouncementsWidgetDtoSchema
>;
