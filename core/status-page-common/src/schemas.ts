import { z } from "zod";

/**
 * Page visibility. `public` = anyone (gated by the anonymous `published.read`
 * grant). `authenticated` = any logged-in user (an internal status page). Higher
 * tiers (password / IP / SSO) are a later phase.
 */
export const StatusPageVisibilitySchema = z.enum(["public", "authenticated"]);
export type StatusPageVisibility = z.infer<typeof StatusPageVisibilitySchema>;

/** Per-page branding. Colors are HSL triples ("262 83% 58%") to match the design tokens. */
export const StatusPageThemeSchema = z.object({
  brandColorHsl: z
    .string()
    .regex(/^\d{1,3} \d{1,3}% \d{1,3}%$/)
    .optional(),
  logoUrl: z.string().url().optional(),
  mode: z.enum(["light", "dark", "auto"]).default("auto"),
});
export type StatusPageTheme = z.infer<typeof StatusPageThemeSchema>;

/**
 * One block in a page layout. `config` is validated PER-TYPE by the backend
 * widget registry (the contract keeps it opaque so new widget types need no
 * contract change). `label` is an optional public heading for the block.
 */
export const StatusPageBlockSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  label: z.string().trim().max(160).optional(),
  config: z.unknown(),
});
export type StatusPageBlock = z.infer<typeof StatusPageBlockSchema>;

export const StatusPageLayoutSchema = z.array(StatusPageBlockSchema);
export type StatusPageLayout = z.infer<typeof StatusPageLayoutSchema>;

/** Slug: lowercase, url-safe; the public page lives at /status/<slug>. */
export const StatusPageSlugSchema = z
  .string()
  .trim()
  .min(1)
  .max(63)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers and dashes");

/** Full admin-facing status page (the builder's working copy). */
export const StatusPageSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  visibility: StatusPageVisibilitySchema,
  theme: StatusPageThemeSchema,
  draftLayout: StatusPageLayoutSchema,
  publishedLayout: StatusPageLayoutSchema.nullable(),
  published: z.boolean(),
  publishedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type StatusPage = z.infer<typeof StatusPageSchema>;

/** Lightweight summary for the list view. */
export const StatusPageSummarySchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  visibility: StatusPageVisibilitySchema,
  published: z.boolean(),
  publishedAt: z.string().nullable(),
  updatedAt: z.string(),
});
export type StatusPageSummary = z.infer<typeof StatusPageSummarySchema>;

// ===========================================================================
// Public output (the ONLY shape the public surface ever receives)
// ===========================================================================

/**
 * A block as rendered publicly: its type + optional label + the resolver's
 * field-allow-listed `data` DTO. `data` is `unknown` at the contract boundary
 * (each widget type defines its own DTO); the resolver validates against the
 * per-type DTO schema before emitting.
 */
export const ResolvedBlockSchema = z.object({
  id: z.string(),
  type: z.string(),
  label: z.string().optional(),
  data: z.unknown(),
});
export type ResolvedBlock = z.infer<typeof ResolvedBlockSchema>;

export const PublishedStatusPageSchema = z.object({
  slug: z.string(),
  title: z.string(),
  theme: StatusPageThemeSchema,
  blocks: z.array(ResolvedBlockSchema),
  /** When the resolver assembled this snapshot (drives client cache hints). */
  generatedAt: z.string(),
});
export type PublishedStatusPage = z.infer<typeof PublishedStatusPageSchema>;
