import type { MentionRef } from "@checkstack/common";
import { extractMentions } from "@checkstack/common";
import { mentionRefKey } from "./mentions";

/**
 * The pure half of viewability-aware mention resolution.
 *
 * Kept separate from the hook so the decisions that matter - which refs a set
 * of documents contains, when two document sets are the same question, and
 * whether a given ref becomes a link - are testable without React.
 */

/**
 * Most refs sent in one viewability request.
 *
 * MUST NOT exceed the bound the resolving procedures declare
 * (`resolveIncidentRefs` / `resolveMaintenanceRefs` cap their input at 200).
 * Collecting more than the backend accepts would fail the whole batch, and
 * since the resolver fails closed that would silently downgrade EVERY mention
 * on the page to plain text - the many-references case being the one where the
 * links matter most. Truncating instead keeps the first 200 working.
 */
export const MAX_MENTION_REFS = 200;

/**
 * Every distinct mention across a set of documents, in first-appearance order.
 *
 * De-duplicated ACROSS documents, not just within one: a detail page passes the
 * description plus every update, and the same reference repeated in five
 * updates must still cost one lookup.
 *
 * Bounded by {@link MAX_MENTION_REFS}; see there for why truncating beats
 * overflowing.
 */
export function collectMentionRefs({
  documents,
  limit = MAX_MENTION_REFS,
}: {
  documents: string[];
  limit?: number;
}): MentionRef[] {
  const seen = new Set<string>();
  const refs: MentionRef[] = [];

  for (const markdown of documents) {
    if (!markdown) continue;
    for (const mention of extractMentions({ markdown })) {
      const key = mentionRefKey(mention);
      if (seen.has(key)) continue;
      seen.add(key);
      refs.push({ type: mention.type, id: mention.id });
      if (refs.length >= limit) return refs;
    }
  }

  return refs;
}

/**
 * A stable cache key for a set of refs.
 *
 * SORTED, so that reordering the prose - or an update arriving that mentions
 * the same records in a different order - is recognised as the same question
 * and does not refetch. Empty for no refs, which callers use to skip the query
 * entirely.
 */
export function mentionRefsKey({ refs }: { refs: MentionRef[] }): string {
  return refs.map((ref) => mentionRefKey(ref)).toSorted().join(",");
}

/**
 * Decide the href for one ref.
 *
 * `viewable` is `undefined` while the check is in flight, and that case must
 * resolve to "no link". Rendering a link first and withdrawing it once the
 * answer arrives would flash a reference the viewer may not be entitled to see;
 * plain-text-then-link only ever reveals something the check has confirmed.
 */
export function resolveViewableRoute({
  ref,
  viewable,
  toRoute,
}: {
  ref: MentionRef;
  viewable: Set<string> | undefined;
  toRoute: (ref: MentionRef) => string | undefined;
}): string | undefined {
  if (!viewable?.has(mentionRefKey(ref))) return undefined;
  return toRoute(ref);
}
