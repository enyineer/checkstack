import React from "react";
import { BulkScopeToTeamAction } from "./BulkScopeToTeamAction";

export interface BulkScopeToTeamSystemsProps {
  /** Selected systems from the catalog bulk-action bar. */
  systems: Array<{ id: string; name: string }>;
  /** Clear the catalog selection after a successful apply. */
  onDone: () => void;
}

/**
 * Fills catalog's `CatalogSystemBulkActionsSlot`: a "Scope to team" button in
 * the systems multi-select bar. A thin adapter over the reusable
 * {@link BulkScopeToTeamAction} for `catalog.system`.
 */
export const BulkScopeToTeamSystems: React.FC<BulkScopeToTeamSystemsProps> = ({
  systems,
  onDone,
}) => (
  <BulkScopeToTeamAction
    resourceType="catalog.system"
    resources={systems}
    onDone={onDone}
  />
);
