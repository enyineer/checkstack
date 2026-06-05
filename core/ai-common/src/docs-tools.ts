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
});
export type SearchDocsOutput = z.infer<typeof SearchDocsOutputSchema>;

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
