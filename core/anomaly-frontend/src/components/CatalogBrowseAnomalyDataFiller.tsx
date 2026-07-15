import React from "react";
import { AnomalyBadgeDataProvider } from "./AnomalyBadgeDataProvider";

/**
 * Fills catalog's `CatalogBrowseDataBoundarySlot`. Wraps the boundary's
 * `children` (the catalog browse / manage tree) in `AnomalyBadgeDataProvider`,
 * so the per-row `SystemAnomalyBadge`s read the anomaly lookup from context
 * (`useAnomalyBadgeDataOptional`) instead of each instantiating its own live
 * query observers - eliminating the per-row observer + array-scan cost.
 *
 * `children` is typed OPTIONAL so the component stays assignable to the slot
 * context (which declares only `systemIds` / `groupIds`); catalog-frontend
 * supplies the children when it folds this filler around the tree. The anomaly
 * fetch is unscoped, so `systemIds` / `groupIds` are unused here.
 */
export const CatalogBrowseAnomalyDataFiller = ({
  children,
}: {
  systemIds: string[];
  groupIds: string[];
  children?: React.ReactNode;
}) => <AnomalyBadgeDataProvider>{children}</AnomalyBadgeDataProvider>;
