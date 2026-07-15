import React from "react";
import { CatalogSystemHealthCheckDataProvider } from "./CatalogSystemHealthCheckDataProvider";

/**
 * Fills catalog's `CatalogBrowseDataBoundarySlot`. Wraps the boundary's
 * `children` (the catalog browse / manage tree) in
 * `CatalogSystemHealthCheckDataProvider`, keyed on the whole visible
 * `systemIds` set, so the per-row `SystemHealthCheckAssignment` reads its gate +
 * assigned-count from context instead of each calling two access hooks and a
 * counts query - the dominant per-row cost of the manage Systems tab.
 *
 * `children` is typed OPTIONAL so the component stays assignable to the slot
 * context (which declares only `systemIds` / `groupIds`); catalog-frontend
 * supplies the children when it folds this filler around the tree.
 */
export const CatalogBrowseHealthCheckDataFiller = ({
  systemIds,
  children,
}: {
  systemIds: string[];
  groupIds: string[];
  children?: React.ReactNode;
}) => (
  <CatalogSystemHealthCheckDataProvider systemIds={systemIds}>
    {children}
  </CatalogSystemHealthCheckDataProvider>
);
