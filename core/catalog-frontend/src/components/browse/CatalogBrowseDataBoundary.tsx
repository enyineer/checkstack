import React from "react";
import { useSlotExtensions } from "@checkstack/frontend-api";
import { CatalogBrowseDataBoundarySlot } from "@checkstack/catalog-common";

export interface CatalogBrowseDataBoundaryProps {
  /** Every system id currently rendered in the browse view. */
  systemIds: string[];
  /** Every real group id currently rendered (excludes the ungrouped section). */
  groupIds: string[];
  /** The browse tree to wrap (group sections + rows). */
  children: React.ReactNode;
}

/**
 * Folds every {@link CatalogBrowseDataBoundarySlot} filler around the browse
 * tree so it renders EXACTLY ONCE, nested inside each provider plugin's
 * bulk-data provider. Per-row/per-group contributions inside then read bulk data
 * from those providers' React context instead of each fetching its own (the N+1
 * this removes). With no filler installed, renders `children` unchanged, so the
 * browse view stays fully functional and each contribution falls back to its own
 * fetch.
 *
 * Only eager (`component`) fillers are folded - a bulk-data PROVIDER is light and
 * always-rendered, so it must be eager, not code-split. Catalog gains no
 * dependency on any provider plugin: it only renders the slot; every provider is
 * contributed by its owning plugin.
 */
export const CatalogBrowseDataBoundary: React.FC<
  CatalogBrowseDataBoundaryProps
> = ({ systemIds, groupIds, children }) => {
  const fillers = useSlotExtensions(CatalogBrowseDataBoundarySlot);
  // Wrap the tree in each eager filler's provider, innermost-last so a filler's
  // provider is available to every descendant. Nesting order between fillers is
  // irrelevant (each provides its own React context). Iterating the reversed
  // list keeps the first-registered filler outermost.
  let wrapped: React.ReactNode = children;
  for (const ext of fillers.toReversed()) {
    const Provider = ext.component;
    if (!Provider) continue; // lazy fillers are not supported here
    // `children` is passed via createElement's children arg, so the slot
    // context type need not (and does not) declare it.
    wrapped = React.createElement(Provider, { systemIds, groupIds }, wrapped);
  }
  return <>{wrapped}</>;
};
