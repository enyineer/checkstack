import type { MentionSuggestion } from "@checkstack/frontend-api";

/** Longest suggestion list returned for one type. */
export const MAX_MENTION_RESULTS = 8;

/**
 * Filter mention candidates by what the author has typed.
 *
 * Case-insensitive substring match on the title, capped. An EMPTY query returns
 * the head of the list rather than nothing, so pressing `#` alone immediately
 * shows something to pick - a picker that stays blank until you guess a
 * matching character reads as broken.
 *
 * Ranked so titles STARTING with the query come first: an author typing `db`
 * almost always means "Database ...", not "Failover for db".
 */
export function filterMentionCandidates({
  candidates,
  query,
  limit = MAX_MENTION_RESULTS,
}: {
  candidates: readonly MentionSuggestion[];
  query: string;
  limit?: number;
}): MentionSuggestion[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return candidates.slice(0, limit);

  const matches = candidates.filter((candidate) =>
    candidate.label.toLowerCase().includes(needle),
  );

  return matches
    .toSorted((a, b) => {
      const aStarts = a.label.toLowerCase().startsWith(needle);
      const bStarts = b.label.toLowerCase().startsWith(needle);
      if (aStarts !== bStarts) return aStarts ? -1 : 1;
      return a.label.localeCompare(b.label);
    })
    .slice(0, limit);
}
