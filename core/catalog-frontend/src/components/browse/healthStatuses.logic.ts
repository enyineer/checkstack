import type { CatalogHealthStatuses } from "@checkstack/catalog-common";

/**
 * Value-equality for two {@link CatalogHealthStatuses} maps.
 *
 * The browse health filler (e.g. healthcheck-frontend) re-reports a freshly
 * built statuses object on every render/poll - a new object identity even when
 * the per-system values are unchanged. If the browse page stored every report,
 * the derived browse model (and therefore every system row) would re-render and
 * remount continuously, making the list impossible to interact with. The page
 * uses this comparison to ignore no-op reports and keep a stable state object.
 *
 * `prev` is `null` until the first report; a first report (even an empty map,
 * meaning "a health source is installed but nothing to report") is always a
 * real change.
 */
export function healthStatusesEqual(
  prev: CatalogHealthStatuses | null,
  next: CatalogHealthStatuses,
): boolean {
  if (prev === null) return false;
  const prevKeys = Object.keys(prev);
  const nextKeys = Object.keys(next);
  if (prevKeys.length !== nextKeys.length) return false;
  for (const key of prevKeys) {
    if (prev[key] !== next[key]) return false;
  }
  return true;
}
