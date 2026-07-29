import { useCallback } from "react";
import { buildMentionMarkdown } from "@checkstack/common";
import { resolveMentionRoute, searchMentions } from "./mentions";

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
