import { qualifyAccessRuleId } from "@checkstack/common";
import {
  aiAccess,
  pluginMetadata as aiPluginMetadata,
  SearchDocsInputSchema,
  SearchDocsOutputSchema,
  GetDocInputSchema,
  GetDocOutputSchema,
  type SearchDocsInput,
  type SearchDocsOutput,
  type GetDocInput,
  type GetDocOutput,
} from "@checkstack/ai-common";
import { DOCS_INDEX, type DocsIndexEntry } from "../generated/docs-index";
import { rankDocs } from "./rank-docs";
import type { RegisteredAiTool } from "../tool-registry";

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
      "relevant pages with a short snippet from each. Use this FIRST to ground " +
      "any how-to or conceptual answer about Checkstack in the real docs, then " +
      "call getDoc to read a promising page in full. Read-only.",
    effect: "read",
    input: SearchDocsInputSchema,
    output: SearchDocsOutputSchema,
    requiredAccessRules: [AI_CHAT_READ],
    async execute({ input }) {
      const hits = rankDocs({ index, query: input.query, limit: input.limit });
      return { hits };
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
      "Read one Checkstack documentation page in full by its slug (as returned " +
      "by searchDocs, e.g. \"user-guide/concepts/health-checks\"). Use this " +
      "after searchDocs to ground an answer in the page's actual content. " +
      "Read-only.",
    effect: "read",
    input: GetDocInputSchema,
    output: GetDocOutputSchema,
    requiredAccessRules: [AI_CHAT_READ],
    async execute({ input }) {
      const entry = index.find((e) => e.slug === input.slug);
      if (!entry) {
        throw new Error(
          `No documentation page with slug "${input.slug}". Use searchDocs to ` +
            "find a valid slug.",
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
  return [createSearchDocsTool({ index }), createGetDocTool({ index })];
}
