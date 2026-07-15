import React, { useState } from "react";
import { Button } from "@checkstack/ui";
import { Users2 } from "lucide-react";
import { useApi, accessApiRef } from "@checkstack/frontend-api";
import { authAccess } from "@checkstack/auth-common";
import { ScopeToTeamDialog } from "./ScopeToTeamDialog";

export interface BulkScopeToTeamActionProps {
  /** Qualified resource type, e.g. "catalog.group". */
  resourceType: string;
  /** The selected resources to scope in one apply. */
  resources: Array<{ id: string; name: string }>;
  /** Clear the caller's selection after a successful apply. */
  onDone: () => void;
  /** Trigger label / tooltip override. */
  label?: string;
}

/**
 * A reusable multi-select "Scope to team" action for a management bulk bar: a
 * ghost button that opens the shared additive {@link ScopeToTeamDialog} for the
 * SELECTED resources of one team-scoped type (systems, groups, environments,
 * ...), so an owner can grant a team Manage/Read on many at once. Hidden unless
 * the caller can manage teams (`auth.teams.manage`, the gate the write enforces).
 *
 * Unlike the per-row {@link ScopeToTeamAction}, only ONE of these is rendered per
 * tab (in the selection bar), so the dialog is not deferred.
 */
export const BulkScopeToTeamAction: React.FC<BulkScopeToTeamActionProps> = ({
  resourceType,
  resources,
  onDone,
  label = "Scope to team",
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
        {label}
      </Button>
      <ScopeToTeamDialog
        open={open}
        onOpenChange={setOpen}
        resourceType={resourceType}
        resources={resources}
        onApplied={onDone}
      />
    </>
  );
};
