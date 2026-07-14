/**
 * Single source of truth for the explorer deep-link URL: the search-param names
 * and the pure builder that opens a stream's Explore tab pre-filtered. Both the
 * cross-plugin correlations panel (which BUILDS a link) and
 * `LogStreamDetailPage` (which READS the params and rebuilds them in
 * `goToExplore`) share these names, so a renamed param is a one-line change and
 * a wrong param is caught by a unit test rather than a dead link.
 */

import { resolveRoute } from "@checkstack/common";
import { logstreamRoutes } from "@checkstack/logstream-common";

/** Search-param names the explorer deep link uses. */
export const EXPLORE_PARAMS = {
  tab: "tab",
  pattern: "pattern",
  traceId: "traceId",
  from: "from",
  to: "to",
} as const;

/** The `tab` value that selects the Explore tab. */
export const EXPLORE_TAB_VALUE = "explore";

export interface BuildExploreHrefInput {
  streamId: string;
  /** Exact trace-id to pre-filter by. */
  traceId?: string;
  /** Window bounds to pre-fill, so a link to an OLD trace still shows its lines
   * instead of falling back to the last-24h default window. */
  from?: Date;
  to?: Date;
}

/**
 * Build a deep link to a stream's Explore tab, pre-filtered by trace id and (if
 * given) time window. Omitted facets add no param. The stream id goes in the
 * path (via {@link resolveRoute}); every facet goes in the query string, so
 * values are URL-encoded by `URLSearchParams`.
 */
export function buildExploreHref({
  streamId,
  traceId,
  from,
  to,
}: BuildExploreHrefInput): string {
  const base = resolveRoute(logstreamRoutes.routes.detail, { streamId });
  const params = new URLSearchParams({
    [EXPLORE_PARAMS.tab]: EXPLORE_TAB_VALUE,
  });
  if (traceId) params.set(EXPLORE_PARAMS.traceId, traceId);
  if (from) params.set(EXPLORE_PARAMS.from, from.toISOString());
  if (to) params.set(EXPLORE_PARAMS.to, to.toISOString());
  return `${base}?${params.toString()}`;
}
