import { useCallback, useMemo } from "react";
import type { MentionResolver } from "@checkstack/ui";
import { usePluginClient } from "@checkstack/frontend-api";
import { StatusPageApi } from "@checkstack/status-page-common";
import {
  collectRefsFromValue,
  publicRefKey,
  resolvePublicMentionHref,
} from "./public-mentions.logic";
import type { BuildDetailHref } from "./renderers";

/**
 * Resolve `#` mentions for a PUBLIC status page.
 *
 * Scans whatever the page is about to render for references, asks the backend
 * which of them this page actually surfaces, and returns a resolver that links
 * only those - to the referenced item's own public detail page.
 *
 * ## Why the page is asked at all
 *
 * Public surfaces used to resolve nothing, so every mention rendered as plain
 * text. That was the safe default rather than a correct one: an operator who
 * writes "caused by #Database upgrade" in a public update wants readers to be
 * able to follow it, and the maintenance window is already published on the
 * very same page. Asking the page turns exactly those into links and leaves
 * everything else - notably an internal-only incident - as plain text.
 *
 * ## Fails closed
 *
 * While the check is in flight, when the page is not published, when detail
 * linking is disabled (the builder preview), or when nothing surfaces the
 * target, the label renders as plain text. A dead link would still confirm the
 * referenced item exists.
 */
export function usePublicMentions({
  slug,
  content,
  buildDetailHref,
}: {
  slug: string;
  /**
   * Whatever this page renders - the block DTOs, or an explicit list of
   * authored documents. Scanned structurally, so a widget shape this package
   * does not know still contributes its references.
   */
  content: unknown;
  buildDetailHref: BuildDetailHref | null;
}): MentionResolver {
  const client = usePluginClient(StatusPageApi);

  const collected = useMemo(
    () => collectRefsFromValue({ value: content }),
    [content],
  );
  // SORTED before it becomes the query input, so the same reference set found
  // in a different order is the same query. The page polls on an interval, so
  // an input that reordered would refetch this on every tick.
  const refs = useMemo(
    () =>
      collected.toSorted((a, b) =>
        publicRefKey(a).localeCompare(publicRefKey(b)),
      ),
    [collected],
  );

  const { data } = client.resolvePublicMentions.useQuery(
    { slug, refs },
    {
      enabled: refs.length > 0 && slug.length > 0,
      // The set of items a page publishes changes on publish, not per poll.
      staleTime: 60_000,
    },
  );

  const resolvedKeys = useMemo(
    () =>
      data?.refs
        ? new Set(data.refs.map((ref) => publicRefKey(ref)))
        : undefined,
    [data],
  );

  return useCallback(
    (ref) =>
      resolvePublicMentionHref({ ref, resolvedKeys, buildDetailHref }),
    [resolvedKeys, buildDetailHref],
  );
}
