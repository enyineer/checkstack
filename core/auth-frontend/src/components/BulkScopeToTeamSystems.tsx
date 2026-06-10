import React, { useState } from "react";
import { Button } from "@checkstack/ui";
import { Users2 } from "lucide-react";
import { useApi, accessApiRef } from "@checkstack/frontend-api";
import { authAccess } from "@checkstack/auth-common";
import { ScopeToTeamDialog } from "./ScopeToTeamDialog";

export interface BulkScopeToTeamSystemsProps {
  /** Selected systems from the catalog bulk-action bar. */
  systems: Array<{ id: string; name: string }>;
  /** Clear the catalog selection after a successful apply. */
  onDone: () => void;
}

/**
 * Fills catalog's `CatalogSystemBulkActionsSlot`: a "Scope to team" button in
 * the systems multi-select bar that opens the shared ScopeToTeamDialog for the
 * selected systems. Hidden unless the caller can manage teams.
 */
export const BulkScopeToTeamSystems: React.FC<BulkScopeToTeamSystemsProps> = ({
  systems,
  onDone,
}) => {
  const accessApi = useApi(accessApiRef);
  const { allowed: canManageTeams } = accessApi.useAccess(
    authAccess.teams.manage,
  );
  const [open, setOpen] = useState(false);

  if (!canManageTeams) return null;

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <Users2 className="mr-1.5 h-4 w-4" />
        Scope to team
      </Button>
      <ScopeToTeamDialog
        open={open}
        onOpenChange={setOpen}
        resourceType="catalog.system"
        resources={systems}
        onApplied={onDone}
      />
    </>
  );
};
