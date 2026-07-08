import { z } from "zod";

/**
 * An http(s) URL. Status pages render these as `<a href>` / `<img src>` on a
 * public surface, so disallow `javascript:` / `data:` / `file:` schemes that
 * `z.string().url()` would otherwise accept (operator-side stored-XSS guard).
 */
export const HttpUrlSchema = z
  .string()
  .url()
  .refine((v) => /^https?:\/\//i.test(v), {
    message: "Must be an http(s) URL",
  });

/**
 * Built-in widget catalogue for status pages. Each widget has:
 *  - a CONFIG schema (what an operator edits + what is stored in the layout), and
 *  - a public DTO schema (the field-ALLOW-LISTED shape the public resolver emits).
 *
 * The DTO is the security boundary: a resolver MUST only ever emit DTO fields,
 * never the source resource's internal config / ids / `createdBy`. New plugins
 * contribute additional widget types via the backend widget-type registry; these
 * are the built-ins shipped by the platform.
 */

/**
 * Industry-standard public status vocabulary (Statuspage/Instatus/Cachet). The
 * INTERNAL health enum (healthy/degraded/unhealthy) is mapped onto this; the
 * public page never exposes the internal enum.
 */
export const PublicStatusSchema = z.enum([
  "operational",
  "degraded",
  "partial_outage",
  "major_outage",
  "maintenance",
  "unknown",
]);
export type PublicStatus = z.infer<typeof PublicStatusSchema>;

/**
 * A bound system with an OPTIONAL public label override. Defaulting to the
 * system's own name risks leaking an internal name (e.g. `prod-db-01.internal`);
 * the override lets operators present a clean public label.
 */
export const SystemBindingSchema = z.object({
  systemId: z.string().min(1),
  label: z.string().trim().max(120).optional(),
});
export type SystemBinding = z.infer<typeof SystemBindingSchema>;

// ===========================================================================
// Config schemas (stored in the layout; admin-edited)
// ===========================================================================

export const BannerConfigSchema = z.object({
  /** Systems whose health rolls up into the overall banner. Empty = no rollup. */
  systemIds: z.array(z.string().min(1)).default([]),
  /** Optional title override (else a status-derived label is shown). */
  title: z.string().trim().max(160).optional(),
});

export const SystemHealthConfigSchema = z.object({
  items: z.array(SystemBindingSchema).default([]),
  /** Show a small uptime % next to each system. */
  showUptime: z.boolean().default(false),
});

export const GroupStatusConfigSchema = z.object({
  groupId: z.string().min(1),
  label: z.string().trim().max(120).optional(),
  /**
   * Collapse the member rows (keeping the group header pill) while every member
   * is operational. Members are revealed automatically when any member is not
   * operational (an issue or maintenance), and can always be expanded manually.
   */
  collapseWhenHealthy: z.boolean().default(false),
});

export const UptimeConfigSchema = z.object({
  systemId: z.string().min(1),
  label: z.string().trim().max(120).optional(),
  /** Days of history to show as daily bars (status-page standard is 90). */
  days: z.number().int().min(1).max(90).default(90),
});

/**
 * Shared config for the event-feed widgets (incidents, maintenance): whether to
 * show the update timeline + how many, and whether to include recently
 * resolved/completed items within a max age.
 */
export const EventFeedConfigSchema = z.object({
  /** Render the per-item update timeline. */
  showUpdates: z.boolean().default(true),
  /** Cap the latest updates shown per item. */
  maxUpdates: z.number().int().min(1).max(10).default(3),
  /** Include resolved incidents / completed maintenances (not just active). */
  includePast: z.boolean().default(false),
  /** Only past items resolved/completed within the last N days. */
  pastMaxAgeDays: z.number().int().min(1).max(90).default(7),
});

/**
 * Shared scope config for the event-feed widgets. The resolved scope is
 * `(systemIds ∪ members(groupIds)) − excludedSystemIds`, computed at RESOLVE
 * TIME so a member added to a group later is reflected automatically. An empty
 * resolved scope fails CLOSED (shows nothing) - it never falls back to "all".
 */
export const EventFeedScopeSchema = z.object({
  /** Explicitly-selected systems. */
  systemIds: z.array(z.string().min(1)).default([]),
  /** Catalog groups whose (current) members are included. */
  groupIds: z.array(z.string().min(1)).default([]),
  /** Systems removed from the resolved scope (e.g. one member of a group). */
  excludedSystemIds: z.array(z.string().min(1)).default([]),
  /**
   * Optional PUBLIC label override per system id (same mechanism as the system-
   * health widget's per-system `label`). The raw catalog name can leak internal
   * naming (e.g. `pay-svc-prod-3.internal`); an override lets operators present a
   * clean public label. Applied when the widget - and therefore the public
   * incident/maintenance DETAIL page - renders a system name; falls back to the
   * catalog name only when there is no override, so naming stays consistent with
   * the rest of the status page.
   */
  systemLabels: z.record(z.string(), z.string().trim().max(120)).default({}),
  limit: z.number().int().min(1).max(20).default(5),
});

export const IncidentsConfigSchema = EventFeedConfigSchema.extend(
  EventFeedScopeSchema.shape,
);

export const MaintenanceConfigSchema = EventFeedConfigSchema.extend(
  EventFeedScopeSchema.shape,
);

export const TextConfigSchema = z.object({
  /** Markdown, rendered SANITIZED on the public page (no raw HTML/JS). */
  markdown: z.string().max(20_000).default(""),
});

export const HeadingConfigSchema = z.object({
  text: z.string().trim().max(200).default(""),
  level: z.number().int().min(1).max(3).default(2),
});

export const LinkSchema = z.object({
  label: z.string().trim().min(1).max(120),
  url: HttpUrlSchema,
});
export const LinksConfigSchema = z.object({
  links: z.array(LinkSchema).max(20).default([]),
});

export const ImageConfigSchema = z.object({
  url: HttpUrlSchema,
  alt: z.string().trim().max(200).optional(),
  maxHeight: z.number().int().min(16).max(400).optional(),
});

export const DividerConfigSchema = z.object({});

// ===========================================================================
// Public DTO schemas (resolver output; the field allow-list)
// ===========================================================================

export const StatusItemDtoSchema = z.object({
  label: z.string(),
  status: PublicStatusSchema,
  uptimePct: z.number().optional(),
});

export const BannerDtoSchema = z.object({
  status: PublicStatusSchema,
  title: z.string(),
});

export const SystemHealthDtoSchema = z.object({
  systems: z.array(StatusItemDtoSchema),
});

export const GroupStatusDtoSchema = z.object({
  label: z.string(),
  status: PublicStatusSchema,
  systems: z.array(StatusItemDtoSchema),
  /** Echoes the config toggle so the renderer can collapse healthy groups. */
  collapseWhenHealthy: z.boolean().default(false),
});

export const UptimeBarSchema = z.object({
  date: z.string(),
  uptimePct: z.number(),
  status: PublicStatusSchema,
});
export const UptimeDtoSchema = z.object({
  label: z.string(),
  uptimePct: z.number(),
  bars: z.array(UptimeBarSchema),
});

/** A public-safe timeline update: NO `createdBy` (that is an internal leak). */
export const PublicUpdateSchema = z.object({
  message: z.string(),
  statusChange: z.string().optional(),
  at: z.string(),
});

export const IncidentDtoItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
  severity: z.string(),
  systems: z.array(z.string()),
  startedAt: z.string(),
  /** When the incident was resolved (present only for resolved incidents). */
  resolvedAt: z.string().optional(),
  updates: z.array(PublicUpdateSchema),
});
export type IncidentDtoItem = z.infer<typeof IncidentDtoItemSchema>;
export const IncidentsDtoSchema = z.object({
  incidents: z.array(IncidentDtoItemSchema),
});

export const MaintenanceDtoItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
  startAt: z.string(),
  endAt: z.string(),
  systems: z.array(z.string()),
  updates: z.array(PublicUpdateSchema),
});
export type MaintenanceDtoItem = z.infer<typeof MaintenanceDtoItemSchema>;
export const MaintenanceDtoSchema = z.object({
  maintenances: z.array(MaintenanceDtoItemSchema),
});

export const TextDtoSchema = z.object({ markdown: z.string() });
export const HeadingDtoSchema = z.object({
  text: z.string(),
  level: z.number(),
});
export const LinksDtoSchema = LinksConfigSchema;
export const ImageDtoSchema = ImageConfigSchema;
export const DividerDtoSchema = z.object({});

// ===========================================================================
// Catalogue: ids + metadata the builder lists
// ===========================================================================

/** What a widget binds to (drives the builder's resource-picker + edit-time authz). */
export const WidgetBindingKindSchema = z.enum([
  "none",
  "system",
  "systems",
  "group",
]);
export type WidgetBindingKind = z.infer<typeof WidgetBindingKindSchema>;

export const WidgetTypeDescriptorSchema = z.object({
  /** Qualified id, e.g. "statuspage.systemHealth". */
  id: z.string(),
  displayName: z.string(),
  description: z.string(),
  category: z.string(),
  binding: WidgetBindingKindSchema,
});
export type WidgetTypeDescriptor = z.infer<typeof WidgetTypeDescriptorSchema>;

/** Stable ids for the built-in widget types (qualified by the plugin id). */
export const BUILTIN_WIDGET_IDS = {
  banner: "statuspage.banner",
  systemHealth: "statuspage.systemHealth",
  groupStatus: "statuspage.groupStatus",
  uptime: "statuspage.uptime",
  incidents: "statuspage.incidents",
  maintenance: "statuspage.maintenance",
  text: "statuspage.text",
  heading: "statuspage.heading",
  links: "statuspage.links",
  image: "statuspage.image",
  divider: "statuspage.divider",
} as const;
