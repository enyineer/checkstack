import type { MentionSuggestion } from "./mentions";

/**
 * Shared ranking for a mention provider's `search`.
 *
 * Lives here, next to {@link MentionSuggestion}, rather than in each owning
 * plugin: every provider wants the same behaviour, and this file previously
 * existed as a byte-identical copy in `incident-frontend` and
 * `maintenance-frontend`. Two copies of a ranking rule drift the moment one is
 * tuned, and the picker then orders incidents and maintenances differently in
 * the same dropdown - which reads as a bug even though each half is
 * self-consistent.
 */

/** Longest suggestion list returned for one type. */
export const MAX_MENTION_RESULTS = 8;

/**
 * Filter and rank mention candidates by what the author has typed.
 *
 * Case-insensitive substring match on the title, capped. An EMPTY query returns
 * the head of the list rather than nothing, so pressing `#` alone immediately
 * shows something to pick - a picker that stays blank until you guess a
 * matching character reads as broken.
 *
 * ## Ranking, in order
 *
 * 1. **Active before closed.** Closed records ARE offered - referencing a
 *    resolved incident from a follow-up is a normal thing to write - but an
 *    author typing `#` almost always means something currently happening, and
 *    finished records accumulate without bound while active ones do not. So
 *    they must never crowd out the live ones.
 * 2. **Prefix before mid-word.** An author typing `data` almost always means
 *    "Database upgrade", not "Restore database".
 * 3. **Alphabetical**, so a searched list is stable rather than dependent on
 *    whatever order the API returned.
 *
 * Steps 2 and 3 apply only when something has been typed. With an EMPTY query
 * the caller's own order is preserved (the sort is stable), which keeps the
 * "just pressed `#`" list in the API's recency order - alphabetising it there
 * would bury the window you scheduled a minute ago under every older `A...`.
 *
 * > [!NOTE]
 * > Because active-first outranks relevance, an author hunting a CLOSED record
 * > by name will not see it while {@link MAX_MENTION_RESULTS} active records
 * > also match the query - they have to type enough to narrow the active set.
 * > That is the deliberate trade: the common case (referencing something live)
 * > stays first, and the rare case still resolves with a few more characters.
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

  const matches = needle
    ? candidates.filter((candidate) =>
        candidate.label.toLowerCase().includes(needle),
      )
    : [...candidates];

  return matches
    .toSorted((a, b) => {
      // Absent means active: a provider with no lifecycle must not be demoted
      // below every other type's live records.
      const aActive = a.isActive !== false;
      const bActive = b.isActive !== false;
      if (aActive !== bActive) return aActive ? -1 : 1;

      // No query: leave the caller's order alone. `toSorted` is stable, so
      // returning 0 here preserves it within each activity group.
      if (!needle) return 0;

      const aStarts = a.label.toLowerCase().startsWith(needle);
      const bStarts = b.label.toLowerCase().startsWith(needle);
      if (aStarts !== bStarts) return aStarts ? -1 : 1;

      return a.label.localeCompare(b.label);
    })
    .slice(0, limit);
}
