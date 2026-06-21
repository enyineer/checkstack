import React, { useState } from "react";
import { Toggle, Label, LoadingSpinner } from "@checkstack/ui";
import { PlusSquare, AlertCircle } from "lucide-react";
import { usePluginClient } from "@checkstack/frontend-api";
import { AuthApi } from "@checkstack/auth-common";
import { useToast, toastError } from "@checkstack/ui";

export interface TeamCreateGrantsEditorProps {
  /** The team whose create-capability grants are being managed. */
  teamId: string;
  /** Whether the current user may change grants (server enforces too). */
  canManage: boolean;
}

/**
 * Per-team editor for create-capability grants: which resource types this
 * team's members may create (and thereby own). Teams without a grant for a type
 * cannot create it, so creation stays admin-only by default. This is where an
 * admin opts a team into "you may create automations / health checks / ..."
 * while reading the resulting objects is unchanged (whoever could already read
 * that resource type still can).
 *
 * Note: incidents and maintenances are NOT listed here — they are gated by
 * MANAGE access on a system (anyone who can manage a system may open incidents
 * and maintenances for it), so they are granted via the system's Team access
 * editor rather than a per-type toggle.
 */
export const TeamCreateGrantsEditor: React.FC<TeamCreateGrantsEditorProps> = ({
  teamId,
  canManage,
}) => {
  const authClient = usePluginClient(AuthApi);
  const toast = useToast();
  // Resource type whose toggle currently has an in-flight mutation, so we can
  // disable just that row and prevent flip-flop double-clicks.
  const [pendingType, setPendingType] = useState<string | null>(null);

  const {
    data: kindsData,
    isLoading: kindsLoading,
    isError: kindsError,
  } = authClient.getResourceKinds.useQuery({});
  const {
    data: grantsData,
    isLoading: grantsLoading,
    isError: grantsError,
  } = authClient.listTeamCreateGrants.useQuery({ teamId });

  const onSettled = () => setPendingType(null);
  const setGrantMutation = authClient.setCreateGrant.useMutation({
    onError: (e) => toastError(toast, "Failed to update grants", e),
    onSettled,
  });

  const createCapable = (kindsData?.kinds ?? []).filter((k) => k.createCapable);
  const grantedTypes = new Set(grantsData?.resourceTypes);

  const header = (
    <Label className="flex items-center gap-1.5">
      <PlusSquare className="h-3.5 w-3.5" />
      Resource creation
    </Label>
  );

  if (kindsLoading || grantsLoading) {
    return (
      <div className="space-y-2 border-t pt-4">
        {header}
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoadingSpinner /> Loading creation rights...
        </div>
      </div>
    );
  }

  if (kindsError || grantsError) {
    return (
      <div className="space-y-2 border-t pt-4">
        {header}
        <div className="flex items-center gap-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" /> Couldn&apos;t load creation rights.
        </div>
      </div>
    );
  }

  const toggle = (resourceType: string, granted: boolean) => {
    setPendingType(resourceType);
    setGrantMutation.mutate({
      objectType: resourceType,
      teamId,
      allowed: !granted,
    });
  };

  return (
    <div className="space-y-2 border-t pt-4">
      {header}
      <p className="text-xs text-muted-foreground">
        Members of this team may create the selected resource types. New objects
        are managed by the team; the grant controls who can change them, not who
        can read them, so whoever can already read that resource type still can.
        Incidents and maintenances are granted via Manage on a system, not here.
      </p>
      {!canManage && (
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground italic">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Only a platform admin can change creation rights. As a team manager you
          can see them here, but not edit them.
        </p>
      )}
      {createCapable.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">
          No resource types currently support team-based creation.
        </p>
      ) : (
        <div className="space-y-1.5">
          {createCapable.map((kind) => {
            const granted = grantedTypes.has(kind.resourceType);
            const rowPending = pendingType === kind.resourceType;
            return (
              <div
                key={kind.resourceType}
                className="flex items-center justify-between gap-2 text-sm"
              >
                <span className="min-w-0">
                  {kind.label}{" "}
                  <span className="text-xs text-muted-foreground">
                    ({kind.pluginId})
                  </span>
                </span>
                <Toggle
                  checked={granted}
                  disabled={!canManage || rowPending}
                  onCheckedChange={() => toggle(kind.resourceType, granted)}
                  aria-label={`Allow ${kind.label} creation`}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
