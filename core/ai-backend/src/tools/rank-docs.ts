import type { DocsIndexEntry } from "../generated/docs-index";

/**
 * One ranked documentation hit produced by {@link rankDocs}. Mirrors the
 * `DocHitSchema` wire shape in `@checkstack/ai-common` (plan §2.5) — kept as a
 * plain interface here so the ranking module is a PURE, dependency-light,
 * unit-testable function over the bundled index.
 */
export interface RankedDocHit {
  slug: string;
  title: string;
  /** Section heading the snippet came from, when the best match is in a heading. */
  heading?: string;
  /** Bounded snippet around the best match, highlighting why the page matched. */
  snippet: string;
  /** BM25-ish relevance score (opaque ordering hint). */
  score: number;
}

/** Max characters in a returned snippet (plan §3.4 size budget). */
export const SNIPPET_MAX_CHARS = 500;

/**
 * Field weights for the BM25-ish term-frequency score. A query term in the
 * title outranks the same term in a heading, which outranks one in the body.
 */
const TITLE_WEIGHT = 8;
const HEADING_WEIGHT = 4;
const DESCRIPTION_WEIGHT = 3;
const CONTENT_WEIGHT = 1;

/**
 * BM25 term-frequency saturation constant. Diminishing returns past a few
 * occurrences of a term, so a page that merely repeats a word does not dominate
 * a page that genuinely covers the topic.
 */
const BM25_K1 = 1.5;

/** Lowercases and splits text into alphanumeric tokens (length >= 2). */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2);
}

/** Counts occurrences of each token in a token list. */
function termCounts(tokens: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const t of tokens) counts.set(t, (counts.get(t) ?? 0) + 1);
  return counts;
}

/**
 * BM25-style term-frequency saturation: tf * (k1 + 1) / (tf + k1). Bounded and
 * monotonic, so more occurrences help but with diminishing returns.
 */
function saturate(tf: number): number {
  if (tf <= 0) return 0;
  return (tf * (BM25_K1 + 1)) / (tf + BM25_K1);
}

interface ScorableEntry {
  entry: DocsIndexEntry;
  titleTokens: Map<string, number>;
  headingTokensByHeading: { heading: string; counts: Map<string, number> }[];
  descriptionTokens: Map<string, number>;
  contentTokens: Map<string, number>;
}

function prepare(entry: DocsIndexEntry): ScorableEntry {
  return {
    entry,
    titleTokens: termCounts(tokenize(entry.title)),
    headingTokensByHeading: entry.headings.map((heading) => ({
      heading,
      counts: termCounts(tokenize(heading)),
    })),
    descriptionTokens: termCounts(tokenize(entry.description ?? "")),
    contentTokens: termCounts(tokenize(entry.content)),
  };
}

/**
 * Picks the best-matching heading for a query (the heading containing the most
 * query terms, by saturated term frequency). Returns `undefined` when no
 * heading matches any query term.
 */
function bestHeading(
  scorable: ScorableEntry,
  queryTerms: string[],
): string | undefined {
  let best: string | undefined;
  let bestScore = 0;
  for (const { heading, counts } of scorable.headingTokensByHeading) {
    let score = 0;
    for (const term of queryTerms) score += saturate(counts.get(term) ?? 0);
    if (score > bestScore) {
      bestScore = score;
      best = heading;
    }
  }
  return best;
}

/**
 * Builds a bounded snippet around the first occurrence of any query term in the
 * content; falls back to the content head when no term is found inline (e.g. the
 * match was purely in the title). Whitespace is collapsed for compactness.
 */
export function buildSnippet({
  content,
  queryTerms,
  maxChars = SNIPPET_MAX_CHARS,
}: {
  content: string;
  queryTerms: string[];
  maxChars?: number;
}): string {
  const normalized = content.replaceAll(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) return normalized;

  const lower = normalized.toLowerCase();
  let matchAt = -1;
  for (const term of queryTerms) {
    const idx = lower.indexOf(term);
    if (idx !== -1 && (matchAt === -1 || idx < matchAt)) matchAt = idx;
  }

  if (matchAt === -1) {
    return normalized.slice(0, maxChars).trimEnd() + "…";
  }

  // Center the window on the match, then clamp to the content bounds.
  const half = Math.floor(maxChars / 2);
  let start = Math.max(0, matchAt - half);
  const end = Math.min(normalized.length, start + maxChars);
  start = Math.max(0, end - maxChars);

  const prefix = start > 0 ? "…" : "";
  const suffix = end < normalized.length ? "…" : "";
  return prefix + normalized.slice(start, end).trim() + suffix;
}

/**
 * Pure BM25-ish ranking over the bundled docs index. Tokenizes the query and
 * scores each entry by saturated term frequency across title (boosted),
 * headings (boosted), description, and content; returns the top-`limit` hits
 * with a bounded snippet around the best match.
 *
 * Deterministic: ties break by score then slug, so the order is stable.
 * Returns `[]` for an empty/whitespace query or when nothing matches.
 */
export function rankDocs({
  index,
  query,
  limit,
}: {
  index: readonly DocsIndexEntry[];
  query: string;
  limit: number;
}): RankedDocHit[] {
  const queryTerms = [...new Set(tokenize(query))];
  if (queryTerms.length === 0 || limit <= 0) return [];

  const scored = index.map((entry) => {
    const scorable = prepare(entry);
    let score = 0;
    for (const term of queryTerms) {
      score += TITLE_WEIGHT * saturate(scorable.titleTokens.get(term) ?? 0);
      score +=
        DESCRIPTION_WEIGHT * saturate(scorable.descriptionTokens.get(term) ?? 0);
      score += CONTENT_WEIGHT * saturate(scorable.contentTokens.get(term) ?? 0);
      // Headings: sum the term's saturated tf across every heading.
      let headingTf = 0;
      for (const { counts } of scorable.headingTokensByHeading) {
        headingTf += counts.get(term) ?? 0;
      }
      score += HEADING_WEIGHT * saturate(headingTf);
    }
    return { scorable, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .toSorted((a, b) =>
      b.score === a.score
        ? a.scorable.entry.slug < b.scorable.entry.slug
          ? -1
          : a.scorable.entry.slug > b.scorable.entry.slug
            ? 1
            : 0
        : b.score - a.score,
    )
    .slice(0, limit)
    .map(({ scorable, score }) => {
      const heading = bestHeading(scorable, queryTerms);
      return {
        slug: scorable.entry.slug,
        title: scorable.entry.title,
        ...(heading ? { heading } : {}),
        snippet: buildSnippet({
          content: scorable.entry.content,
          queryTerms,
        }),
        score,
      };
    });
}
