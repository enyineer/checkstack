import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { buildMentionMarkdown } from "@checkstack/common";
import {
  resolveMentionRoute,
  resolveViewableMentions,
  searchMentions,
} from "./mentions";
import {
  collectMentionRefs,
  mentionRefsKey,
  resolveViewableRoute,
} from "./mention-resolution.logic";

/**
 * The two halves a markdown surface needs to support cross-entity mentions:
 * a `#` search for the editor, and a resolver for the renderer.
 *
 * Both are stable references, so passing them into a memoised editor or a
 * markdown renderer does not defeat its bail-out.
 */
export function useMentions(): {
  onMentionSearch: (props: { query: string }) => Promise<
    { key: string; label: string; description?: string; markdown: string }[]
  >;
  resolveMention: (ref: { type: string; id: string }) => string | undefined;
} {
  const onMentionSearch = useCallback(async ({ query }: { query: string }) => {
    const results = await searchMentions({ query });
    return results.map((result) => ({
      key: `${result.type}/${result.id}`,
      label: result.label,
      // Names the TYPE as well as the record, because two plugins can easily
      // hold similarly-titled records and the label alone would not say which
      // one the author is about to link.
      description: result.description
        ? `${result.displayName} - ${result.description}`
        : result.displayName,
      markdown: buildMentionMarkdown({
        type: result.type,
        id: result.id,
        label: result.label,
      }),
    }));
  }, []);

  const resolveMention = useCallback(
    (ref: { type: string; id: string }) => resolveMentionRoute(ref),
    [],
  );

  return { onMentionSearch, resolveMention };
}

/**
 * A mention resolver that links ONLY the references this viewer may read.
 *
 * ## Why the documents are an input
 *
 * A markdown renderer resolves each link during render, which cannot await
 * anything. So the viewability answer has to exist before rendering starts,
 * which means knowing the references up front - hence passing the documents
 * (the description plus every update) rather than resolving lazily per link.
 * One batched request covers the whole page.
 *
 * ## What it fixes
 *
 * {@link useMentions}'s plain `resolveMention` maps any well-formed reference
 * to a route without asking whether the target exists or whether the viewer may
 * read it, so a mention to a deleted or unreadable record renders as a link to
 * a not-found page or an access gate. This asks the owning plugin, and renders
 * anything unconfirmed as plain text.
 *
 * ## Fails closed
 *
 * While the check is in flight, and for any provider that cannot answer, every
 * mention renders as plain text. The label is always shown either way, so the
 * prose stays readable; only the link is withheld.
 */
export function useMentionResolution({
  documents,
}: {
  documents: string[];
}): {
  resolveMention: (ref: { type: string; id: string }) => string | undefined;
  /** True while the viewability check is outstanding. */
  isResolving: boolean;
} {
  // Join-then-split so the memo depends on CONTENT, not on the array identity:
  // callers build this list inline from a query result, so a new array arrives
  // on every render and a raw `[documents]` dep would recompute forever.
  const joined = documents.join(DOCUMENT_SEPARATOR);
  const refs = useMemo(
    () => collectMentionRefs({ documents: joined.split(DOCUMENT_SEPARATOR) }),
    [joined],
  );
  const refsKey = useMemo(() => mentionRefsKey({ refs }), [refs]);

  // Returns a sorted ARRAY, not the Set the resolver wants, so React Query's
  // structural sharing can keep `data` referentially stable when the answer has
  // not changed. A Set is opaque to that sharing, so every settle handed back a
  // fresh object, changed `resolveMention`'s identity, and re-rendered the whole
  // updates section - including, mid-interaction, a form with an open Radix
  // Select, whose portal then never closed and left the page inert.
  const { data: viewableKeys, isFetching } = useQuery({
    queryKey: ["checkstack", "mention-viewability", refsKey],
    queryFn: async () => {
      const viewable = await resolveViewableMentions({ refs });
      return [...viewable].toSorted();
    },
    // Nothing to ask about, and `enabled: false` keeps `data` undefined, which
    // resolves to "no link" - correct, since there are no mentions to link.
    enabled: refs.length > 0,
    // Readability changes with team grants and deletions, not by the second.
    // Long enough that navigating between updates on one page reuses it.
    staleTime: 30_000,
  });

  const viewable = useMemo(
    () => (viewableKeys ? new Set(viewableKeys) : undefined),
    [viewableKeys],
  );

  const resolveMention = useCallback(
    (ref: { type: string; id: string }) =>
      resolveViewableRoute({ ref, viewable, toRoute: resolveMentionRoute }),
    [viewable],
  );

  return { resolveMention, isResolving: isFetching };
}

/**
 * Separator for the content-keyed memo above. A control character, so it cannot
 * occur in authored markdown and two documents can never be joined into a
 * reference that neither contains.
 */
const DOCUMENT_SEPARATOR = "\u0000";
