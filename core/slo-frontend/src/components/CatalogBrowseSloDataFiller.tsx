import React from "react";
import { SloBadgeDataProvider } from "./SloBadgeDataProvider";

/**
 * Fills catalog's `CatalogBrowseDataBoundarySlot`. Wraps the boundary's
 * `children` (the entire catalog browse tree) in `SloBadgeDataProvider`, keyed
 * on the whole visible `systemIds` set, so the per-row `SystemSloBadge`s read
 * the bulk-fetched SLO objectives from context (`useSloBadgeDataOptional`)
 * instead of each issuing a per-row RPC — eliminating the browse view's N+1.
 *
 * `children` is typed OPTIONAL so the component stays assignable to the slot
 * context (which declares only `systemIds` / `groupIds`); catalog-frontend
 * supplies the actual children when it folds this filler around the tree. The
 * filler renders `children` exactly once, inside the provider.
 */
export const CatalogBrowseSloDataFiller = ({
  systemIds,
  children,
}: {
  systemIds: string[];
  groupIds: string[];
  children?: React.ReactNode;
}) => (
  <SloBadgeDataProvider systemIds={systemIds}>{children}</SloBadgeDataProvider>
);
