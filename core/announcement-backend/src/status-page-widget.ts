import {
  AnnouncementApi,
  pluginMetadata,
  ANNOUNCEMENTS_WIDGET_ID,
  AnnouncementsWidgetConfigSchema,
  AnnouncementsWidgetDtoSchema,
} from "@checkstack/announcement-common";
import type {
  WidgetTypeDefinition,
  StatusWidgetTypeExtensionPoint,
} from "@checkstack/status-page-backend";

function iso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

/**
 * Status-page "Announcements" widget, OWNED by the announcement plugin.
 *
 * It binds to no resource (`binding: "none"`, empty `boundResources`) - it shows
 * the instance-wide PUBLIC announcements, not a per-resource selection. The
 * resolver runs as a TRUSTED principal, so it MUST filter to `visibility: "all"`
 * and emit only the public-safe DTO fields (title / message / severity /
 * timestamps) - never `id`, `createdBy`, `visibility`, or `displayMode`. It also
 * emits no `status`, so announcements never affect the page's status rollup.
 */
const announcements: WidgetTypeDefinition = {
  id: ANNOUNCEMENTS_WIDGET_ID,
  displayName: "Announcements",
  description: "Currently active public announcements.",
  category: "Content",
  binding: "none",
  configSchema: AnnouncementsWidgetConfigSchema,
  dtoSchema: AnnouncementsWidgetDtoSchema,
  boundResources: () => [],
  async resolvePublic({ config, ctx }) {
    const c = AnnouncementsWidgetConfigSchema.parse(config);
    const { announcements: active } = await ctx.rpcClient
      .forPlugin(AnnouncementApi)
      .getActiveAnnouncements({});
    const items = active
      // Public surface: only announcements visible to EVERYONE. Authenticated-
      // only announcements must never reach an anonymous status-page visitor.
      .filter((a) => a.visibility === "all")
      .slice(0, c.limit)
      // Strip to the public allow-list - drop id / createdBy / visibility /
      // displayMode / active / expiresAt / updatedAt.
      .map((a) => ({
        title: a.title,
        message: a.message,
        severity: a.severity,
        ...(a.startsAt ? { startsAt: iso(a.startsAt) } : {}),
        createdAt: iso(a.createdAt),
      }));
    return AnnouncementsWidgetDtoSchema.parse({ announcements: items });
  },
};

/** Register the announcement-owned status-page widget. */
export function registerAnnouncementStatusWidgets(
  ext: StatusWidgetTypeExtensionPoint,
): void {
  ext.registerWidgetType(announcements, pluginMetadata);
}
