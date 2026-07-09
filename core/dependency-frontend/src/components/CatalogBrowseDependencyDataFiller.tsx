import React from "react";
import { DependencyBadgeDataProvider } from "./DependencyBadgeDataProvider";

/**
 * Fills catalog's `CatalogBrowseDataBoundarySlot`. Wraps the boundary's
 * `children` (the entire catalog browse tree) in dependency-frontend's
 * `DependencyBadgeDataProvider`, keyed on the whole visible `systemIds` set, so
 * the per-row DependencyBadge reads the bulk-fetched dependency warnings from
 * context (`useDependencyBadgeDataOptional`) instead of each issuing a per-row
 * `getWarningsForSystem` RPC — eliminating the browse view's N+1.
 *
 * `children` is typed OPTIONAL so the component stays assignable to the slot
 * context (which declares only `systemIds` / `groupIds`); catalog-frontend
 * supplies the actual children when it folds this filler around the tree. The
 * filler renders `children` exactly once, inside the provider.
 */
export const CatalogBrowseDependencyDataFiller = ({
  systemIds,
  children,
}: {
  systemIds: string[];
  groupIds: string[];
  children?: React.ReactNode;
}) => (
  <DependencyBadgeDataProvider systemIds={systemIds}>
    {children}
  </DependencyBadgeDataProvider>
);
