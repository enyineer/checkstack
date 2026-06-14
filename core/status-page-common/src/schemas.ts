import { z } from "zod";
import { HttpUrlSchema } from "./widget-types";

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
  logoUrl: HttpUrlSchema.optional(),
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

export const StatusPageLayoutSchema = z
  .array(StatusPageBlockSchema)
  .max(100)
  .superRefine((blocks, ctx) => {
    // Block ids are client-generated; reject duplicates so a layout can't carry
    // two blocks with the same id (which would break React keys + per-block ops).
    const seen = new Set<string>();
    for (const block of blocks) {
      if (seen.has(block.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate block id: ${block.id}`,
        });
      }
      seen.add(block.id);
    }
  });
export type StatusPageLayout = z.infer<typeof StatusPageLayoutSchema>;

/** Slug: lowercase, url-safe; the public page lives at /status/<slug>. */
export const StatusPageSlugSchema = z
  .string()
  .trim()
  .min(1)
  .max(63)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers and dashes");

/**
 * DNS label of the TXT record an operator adds to prove ownership of a custom
 * domain: `<prefix>.<domain>` must contain the page's verification token.
 */
export const CUSTOM_DOMAIN_TXT_PREFIX = "_checkstack-verify";

/** The TXT record name an operator must create to verify `domain`. */
export function customDomainTxtRecordName(domain: string): string {
  return `${CUSTOM_DOMAIN_TXT_PREFIX}.${domain}`;
}

/**
 * A custom domain (FQDN) a status page can be served on, e.g.
 * `status.acme.com`. No scheme, port, path, or wildcard; 2+ dotted labels, each
 * starting/ending alphanumeric. Stored lowercased by the backend.
 */
export const CustomDomainSchema = z
  .string()
  .trim()
  .min(3)
  .max(253)
  .regex(
    /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i,
    "Enter a domain like status.example.com (no scheme, port or path)",
  );

/** Custom-domain state surfaced to the builder. */
export const CustomDomainInfoSchema = z.object({
  domain: z.string(),
  /** The DNS TXT record the operator must add to verify ownership. */
  verification: z.object({
    recordName: z.string(),
    recordValue: z.string(),
  }),
  /** True once DNS ownership has been verified (the domain then routes). */
  verified: z.boolean(),
  verifiedAt: z.string().nullable(),
});
export type CustomDomainInfo = z.infer<typeof CustomDomainInfoSchema>;

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
  /** Custom domain config, or null when the page is served only at /status/<slug>. */
  customDomain: CustomDomainInfoSchema.nullable(),
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
  /** Custom domain (FQDN) if configured, else null. Verified state lives on the full page. */
  customDomain: z.string().nullable(),
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

/**
 * A frontend renderer remote a page needs because one of its blocks is a
 * THIRD-PARTY widget type whose renderer is not bundled. The minimal
 * custom-domain public bundle loads exactly these (and no others) so it can draw
 * the block; built-in widgets never appear here. `packageName` is the owning
 * frontend plugin's npm package (served at `/assets/plugins/<packageName>/`).
 */
export const RendererRemoteSchema = z.object({
  widgetTypeId: z.string(),
  packageName: z.string(),
});
export type RendererRemote = z.infer<typeof RendererRemoteSchema>;

export const PublishedStatusPageSchema = z.object({
  slug: z.string(),
  title: z.string(),
  theme: StatusPageThemeSchema,
  blocks: z.array(ResolvedBlockSchema),
  /**
   * Renderer remotes this page needs for third-party widget types (deduped).
   * Empty for built-in-only pages. The public bundle loads exactly these.
   */
  rendererRemotes: z.array(RendererRemoteSchema).default([]),
  /** When the resolver assembled this snapshot (drives client cache hints). */
  generatedAt: z.string(),
});
export type PublishedStatusPage = z.infer<typeof PublishedStatusPageSchema>;
