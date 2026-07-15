import { resolveRoute } from "@checkstack/common";
import { tracestreamRoutes } from "./routes";

/**
 * Build the deep link that opens a single trace on the trace-stream detail
 * page. The path comes from the route definition via `resolveRoute` (never a
 * hand-concatenated prefix) so a change to `tracestreamRoutes.detail` follows
 * automatically. The `tab`/`trace` search params mirror how
 * `TraceStreamDetailPage` reads the URL: it selects the `traces` tab via `tab`
 * and opens the trace via `trace`. Pure and browser-safe so every cross-plugin
 * "View trace" jump-off (tracestream's own fillers, metricstream's exemplar
 * lane) shares ONE link builder and a wrong param is caught by a unit test
 * rather than a dead link.
 */
export function buildViewTraceHref({
  streamId,
  traceId,
}: {
  streamId: string;
  traceId: string;
}): string {
  const base = resolveRoute(tracestreamRoutes.routes.detail, { streamId });
  const search = new URLSearchParams({ tab: "traces", trace: traceId });
  return `${base}?${search.toString()}`;
}
