import React, { useState } from "react";
import { RowAction } from "@checkstack/ui";
import { Users2 } from "lucide-react";
import { useApi, accessApiRef } from "@checkstack/frontend-api";
import { authAccess } from "@checkstack/auth-common";
import { ScopeToTeamDialog } from "./ScopeToTeamDialog";

export interface ScopeToTeamActionProps {
  /** Qualified resource type, e.g. "catalog.group". */
  resourceType: string;
  resourceId: string;
  resourceName: string;
  /** Accessible label / tooltip override. */
  label?: string;
}

/**
 * A reusable per-row "Scope to team" action: a `RowAction` (people icon) that
 * opens the shared additive {@link ScopeToTeamDialog} for ONE resource, so an
 * owner of any team-scoped type (system, group, environment, ...) can grant a
 * team Manage/Read on it from the management table. Hidden unless the caller can
 * manage teams (`auth.teams.manage`, the gate the write itself enforces).
 *
 * The Radix dialog is deferred until first use, so a table that renders this per
 * row does not mount an idle dialog per row.
 */
export const ScopeToTeamAction: React.FC<ScopeToTeamActionProps> = ({
  resourceType,
  resourceId,
  resourceName,
  label,
}) => {
  const accessApi = useApi(accessApiRef);
  const { allowed: canManageTeams } = accessApi.useAccess(
    authAccess.teams.manage,
  );
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  if (!canManageTeams) return null;

  return (
    <>
      <RowAction
        icon={Users2}
        label={label ?? `Scope ${resourceName} to a team`}
        onClick={() => {
          setMounted(true);
          setOpen(true);
        }}
      />
      {mounted && (
        <ScopeToTeamDialog
          open={open}
          onOpenChange={setOpen}
          resourceType={resourceType}
          resources={[{ id: resourceId, name: resourceName }]}
        />
      )}
    </>
  );
};
