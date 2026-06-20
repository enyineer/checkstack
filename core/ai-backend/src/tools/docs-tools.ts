import { qualifyAccessRuleId } from "@checkstack/common";
import {
  aiAccess,
  pluginMetadata as aiPluginMetadata,
  SearchDocsInputSchema,
  SearchDocsOutputSchema,
  GetDocInputSchema,
  GetDocOutputSchema,
  ListDocsInputSchema,
  ListDocsOutputSchema,
  type SearchDocsInput,
  type SearchDocsOutput,
  type GetDocInput,
  type GetDocOutput,
  type ListDocsInput,
  type ListDocsOutput,
} from "@checkstack/ai-common";
import { DOCS_INDEX, type DocsIndexEntry } from "../generated/docs-index";
import { rankDocs, isStrongTopHit, type RankedDocHit } from "./rank-docs";
import type { RegisteredAiTool } from "../tool-registry";

/** The first slug segment is the page's top-level section (""=root landing). */
function sectionOf(slug: string): string {
  const seg = slug.split("/")[0];
  return seg.length > 0 ? seg : "(root)";
}

/** Guidance steering the model off the re-search loop and onto the sitemap. */
function searchNote(hits: RankedDocHit[]): string {
  if (hits.length === 0) {
    return (
      "No documentation matched. Do NOT retry with reworded queries - call " +
      "listDocs to see every page, and if no title fits, the docs do not cover " +
      "this: say so plainly rather than searching again."
    );
  }
  if (!isStrongTopHit(hits)) {
    return (
      "These are weak matches - they may just share a common word with your " +
      "query. If none of these titles/snippets actually address the question, do " +
      "NOT re-search with different wording: call listDocs to confirm coverage, " +
      "or conclude the docs do not cover it and say so."
    );
  }
  return "Read the most relevant page in full with getDoc before answering.";
}

/**
 * Documentation-grounding tools (`ai.searchDocs` + `ai.getDoc`, plan §2.5).
 * Both are composite `effect: "read"` tools: they compose the BUILD-TIME bundled
 * docs index (`DOCS_INDEX`, plan §3.4) rather than projecting a single oRPC
 * procedure, so they run their own `execute` in the chat loop's composite-read
 * path. Gated by `ai.chat.read`: any chat user may read the platform's own
 * public documentation; the docs carry no per-tenant data.
 *
 * The bundled index is identical on every pod (it is part of the same build
 * artifact), so a read returns the same answer everywhere — no pod-local state
 * (plan §7.2).
 */

/** The qualified access rule both docs tools require: `ai.chat.read`. */
const AI_CHAT_READ = qualifyAccessRuleId(aiPluginMetadata, aiAccess.chatUse);

/**
 * Builds `ai.searchDocs`: keyword/BM25-ish ranking over the bundled index. The
 * ranking itself is the pure, unit-tested {@link rankDocs}; this builder only
 * adapts the input/output to the wire contract.
 *
 * `index` is injectable for tests; production uses the bundled `DOCS_INDEX`.
 */
export function createSearchDocsTool({
  index = DOCS_INDEX,
}: {
  index?: readonly DocsIndexEntry[];
} = {}): RegisteredAiTool<SearchDocsInput, SearchDocsOutput> {
  return {
    name: "searchDocs",
    description:
      "Search Checkstack's own documentation by keyword and return the most " +
      "relevant pages with a short snippet and a relevance score from each, plus " +
      "a `note` telling you what to do next. Good for a targeted keyword lookup; " +
      "for an overview of what topics exist, prefer listDocs. Then call getDoc to " +
      "read a promising page in full. If the hits are weak/off-topic, do NOT " +
      "re-search with reworded queries - use listDocs or conclude the docs do " +
      "not cover it. Read-only.",
    effect: "read",
    input: SearchDocsInputSchema,
    output: SearchDocsOutputSchema,
    requiredAccessRules: [AI_CHAT_READ],
    async execute({ input }) {
      const hits = rankDocs({ index, query: input.query, limit: input.limit });
      return { hits, note: searchNote(hits) };
    },
  };
}

/**
 * Builds `ai.listDocs`: the documentation sitemap. Returns every page's slug,
 * title, and description (optionally narrowed to one top-level section) so the
 * model can see the whole map at a glance, jump straight to the right page with
 * getDoc, and - crucially - tell when NO page covers a topic instead of looping
 * on `searchDocs`. Content is intentionally omitted (use getDoc for that).
 */
export function createListDocsTool({
  index = DOCS_INDEX,
}: {
  index?: readonly DocsIndexEntry[];
} = {}): RegisteredAiTool<ListDocsInput, ListDocsOutput> {
  return {
    name: "listDocs",
    description:
      "List the Checkstack documentation sitemap - every page's slug, title, and " +
      "description (pass an optional `section` like \"user-guide\" or " +
      "\"developer-guide\" to narrow). Use this to see what IS and ISN'T " +
      "documented and pick the exact page to read with getDoc, instead of " +
      "repeatedly searching. If no page covers the topic, the docs do not cover " +
      "it - say so rather than searching again. Read-only.",
    effect: "read",
    input: ListDocsInputSchema,
    output: ListDocsOutputSchema,
    requiredAccessRules: [AI_CHAT_READ],
    async execute({ input }) {
      const sections = [
        ...new Set(index.map((e) => sectionOf(e.slug))),
      ].toSorted();
      const pages = index
        .filter((e) => !input.section || sectionOf(e.slug) === input.section)
        .map((e) => ({
          slug: e.slug,
          title: e.title,
          ...(e.description ? { description: e.description } : {}),
        }));
      const note =
        pages.length === 0
          ? `No pages in section "${input.section}". Available sections: ${sections.join(", ")}.`
          : "Pick the page whose title/description best fits and read it with getDoc. If none fits, the docs do not cover this - say so instead of searching.";
      return { pages, sections, note };
    },
  };
}

/**
 * Builds `ai.getDoc`: returns one documentation page's full (frontmatter-
 * stripped, byte-capped) content by slug. An unknown slug yields a clear error
 * the model can recover from (it can re-`searchDocs`).
 */
export function createGetDocTool({
  index = DOCS_INDEX,
}: {
  index?: readonly DocsIndexEntry[];
} = {}): RegisteredAiTool<GetDocInput, GetDocOutput> {
  return {
    name: "getDoc",
    description:
      "Read one Checkstack documentation page in full by its slug. The slug MUST " +
      "be copied verbatim from a searchDocs or listDocs result (e.g. " +
      "\"user-guide/concepts/health-checks\") - do NOT guess or construct a slug " +
      "from the topic name, as a made-up slug will not resolve. Use this after " +
      "searchDocs/listDocs to ground an answer in the page's actual content. " +
      "Read-only.",
    effect: "read",
    input: GetDocInputSchema,
    output: GetDocOutputSchema,
    requiredAccessRules: [AI_CHAT_READ],
    async execute({ input }) {
      const entry = index.find((e) => e.slug === input.slug);
      if (!entry) {
        // The model likely constructed the slug from the topic rather than
        // copying one from searchDocs/listDocs. Point it at the closest real
        // pages (matched on the slug's own words) so it recovers in one step
        // instead of guessing again.
        const suggestions = rankDocs({
          index,
          query: input.slug.replaceAll(/[/-]/g, " "),
          limit: 3,
        });
        const didYouMean =
          suggestions.length > 0
            ? ` Did you mean one of: ${suggestions
                .map((s) => `"${s.slug}"`)
                .join(", ")}?`
            : "";
        throw new Error(
          `No documentation page with slug "${input.slug}". Slugs must come from ` +
            `searchDocs or listDocs results, not be guessed.${didYouMean} ` +
            "Call listDocs to see every page, or conclude the docs do not cover " +
            "this.",
        );
      }
      return {
        slug: entry.slug,
        title: entry.title,
        ...(entry.description ? { description: entry.description } : {}),
        content: entry.content,
        truncated: entry.truncated,
      };
    },
  };
}

/**
 * Builds both docs-grounding tools (the Phase 1 registration unit). Returns the
 * erased `RegisteredAiTool` form so callers can iterate + register uniformly
 * (the two tools have different input/output shapes).
 */
export function createDocsTools({
  index = DOCS_INDEX,
}: {
  index?: readonly DocsIndexEntry[];
} = {}): RegisteredAiTool[] {
  return [
    createListDocsTool({ index }),
    createSearchDocsTool({ index }),
    createGetDocTool({ index }),
  ];
}
