import { z } from "zod";

/**
 * Wire contracts for the AI assistant's documentation-grounding tools
 * (`ai.searchDocs` + `ai.getDoc`, plan §2.5). Both tools are `effect: "read"`
 * and gated by `ai.chat.read`: any chat user may read the platform's own public
 * documentation; the docs carry no per-tenant data.
 *
 * The docs themselves are a build-time bundled index in `@checkstack/ai-backend`
 * (plan §3.4) — these schemas live in `-common` so the contract is shared.
 */

export const SearchDocsInputSchema = z.object({
  query: z.string().min(1).max(400),
  /** Max ranked hits to return (capped server-side; see size budget §3.4). */
  limit: z.number().int().min(1).max(10).default(5),
});
export type SearchDocsInput = z.infer<typeof SearchDocsInputSchema>;

/** One ranked doc hit: enough for the model to decide whether to getDoc it. */
export const DocHitSchema = z.object({
  /** Slug-based address, e.g. "user-guide/concepts/health-checks". */
  slug: z.string(),
  title: z.string(),
  /** Section heading the snippet came from (when the hit is a sub-section). */
  heading: z.string().optional(),
  /** The matching snippet (bounded length), highlighting why it matched. */
  snippet: z.string(),
  /** BM25-ish relevance score (opaque ordering hint). */
  score: z.number(),
});
export type DocHit = z.infer<typeof DocHitSchema>;

export const SearchDocsOutputSchema = z.object({
  hits: z.array(DocHitSchema),
  /**
   * Model-facing guidance on what to do next, derived from the hit quality.
   * When nothing matches well it tells the model to consult `listDocs` or
   * conclude the docs do not cover the topic, rather than re-running near-
   * identical searches (the dominant cause of wasted tool calls).
   */
  note: z.string(),
});
export type SearchDocsOutput = z.infer<typeof SearchDocsOutputSchema>;

/**
 * `ai.listDocs` - the documentation sitemap. Returns every page's slug, title,
 * and description so the model can SEE what is and is not documented and jump
 * straight to the right page with `getDoc`, instead of fuzzing `searchDocs`.
 */
export const ListDocsInputSchema = z.object({
  /**
   * Optional top-level section to filter to (the first slug segment, e.g.
   * "user-guide" or "developer-guide"). Omit to list every page.
   */
  section: z.string().min(1).optional(),
});
export type ListDocsInput = z.infer<typeof ListDocsInputSchema>;

/** One page in the sitemap: enough to decide whether to getDoc it. */
export const DocSummarySchema = z.object({
  slug: z.string(),
  title: z.string(),
  description: z.string().optional(),
});
export type DocSummary = z.infer<typeof DocSummarySchema>;

export const ListDocsOutputSchema = z.object({
  /** Every page (optionally filtered by `section`), sorted by slug. */
  pages: z.array(DocSummarySchema),
  /** The available top-level sections, so the model can narrow a follow-up call. */
  sections: z.array(z.string()),
  /** Model-facing guidance (e.g. "if no title fits, the docs don't cover it"). */
  note: z.string(),
});
export type ListDocsOutput = z.infer<typeof ListDocsOutputSchema>;

export const GetDocInputSchema = z.object({
  slug: z.string().min(1),
});
export type GetDocInput = z.infer<typeof GetDocInputSchema>;

export const GetDocOutputSchema = z.object({
  slug: z.string(),
  title: z.string(),
  description: z.string().optional(),
  /** Full page content (markdown, frontmatter stripped), bounded; see §3.4. */
  content: z.string(),
  /** True when content was truncated to the size budget. */
  truncated: z.boolean(),
});
export type GetDocOutput = z.infer<typeof GetDocOutputSchema>;
