import React from "react";
import { SystemBadgeDataProvider } from "./SystemBadgeDataProvider";

/**
 * Fills catalog's `CatalogBrowseDataBoundarySlot`. Wraps the boundary's
 * `children` (the entire catalog browse tree) in dashboard-frontend's existing
 * `SystemBadgeDataProvider`, keyed on the whole visible `systemIds` set, so the
 * per-row health / incident / maintenance badges read the bulk-fetched data from
 * context (`useSystemBadgeDataOptional`) instead of each issuing a per-row RPC —
 * eliminating the browse view's N+1.
 *
 * `children` is typed OPTIONAL so the component stays assignable to the slot
 * context (which declares only `systemIds` / `groupIds`); catalog-frontend
 * supplies the actual children when it folds this filler around the tree. The
 * filler renders `children` exactly once, inside the provider.
 */
export const CatalogBrowseBadgeDataFiller = ({
  systemIds,
  children,
}: {
  systemIds: string[];
  groupIds: string[];
  children?: React.ReactNode;
}) => (
  <SystemBadgeDataProvider systemIds={systemIds}>
    {children}
  </SystemBadgeDataProvider>
);
