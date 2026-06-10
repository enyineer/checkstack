import React, { useState } from "react";
import { Button } from "@checkstack/ui";
import { Users2 } from "lucide-react";
import { useApi, accessApiRef } from "@checkstack/frontend-api";
import { authAccess } from "@checkstack/auth-common";
import { ScopeToTeamDialog } from "./ScopeToTeamDialog";

export interface ScopeSystemToTeamActionProps {
  systemId: string;
  systemName: string;
}

/**
 * Fills catalog's `CatalogSystemActionsSlot`: a quick "Scope to team" action on
 * a single system row, opening the shared ScopeToTeamDialog. The full
 * per-team Read/Manage/private controls remain in the system editor's Team
 * access section; this is the fast path. Hidden unless the caller can manage
 * teams.
 */
export const ScopeSystemToTeamAction: React.FC<
  ScopeSystemToTeamActionProps
> = ({ systemId, systemName }) => {
  const accessApi = useApi(accessApiRef);
  const { allowed: canManageTeams } = accessApi.useAccess(
    authAccess.teams.manage,
  );
  const [open, setOpen] = useState(false);

  if (!canManageTeams) return null;

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        title="Scope this system to a team"
      >
        <Users2 className="h-4 w-4" />
      </Button>
      <ScopeToTeamDialog
        open={open}
        onOpenChange={setOpen}
        resourceType="catalog.system"
        resources={[{ id: systemId, name: systemName }]}
      />
    </>
  );
};
