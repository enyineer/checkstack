import React from "react";
import { ScopeToTeamAction } from "./ScopeToTeamAction";

export interface ScopeSystemToTeamActionProps {
  systemId: string;
  systemName: string;
}

/**
 * Fills catalog's `CatalogSystemActionsSlot`: the per-system "Scope to team"
 * quick action. A thin adapter over the reusable {@link ScopeToTeamAction} for
 * `catalog.system`; the full per-team Read/Manage/private controls remain in the
 * system detail page's Team access section.
 */
export const ScopeSystemToTeamAction: React.FC<
  ScopeSystemToTeamActionProps
> = ({ systemId, systemName }) => (
  <ScopeToTeamAction
    resourceType="catalog.system"
    resourceId={systemId}
    resourceName={systemName}
    label="Scope this system to a team"
  />
);
