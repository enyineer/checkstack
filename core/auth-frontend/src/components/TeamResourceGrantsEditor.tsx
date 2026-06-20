import React, { useState } from "react";
import {
  Label,
  LoadingSpinner,
  Button,
  Checkbox,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  useToast,
  toastError,
} from "@checkstack/ui";
import { ShieldCheck, AlertCircle, Trash2, Eye, Settings } from "lucide-react";
import { usePluginClient } from "@checkstack/frontend-api";
import { AuthApi } from "@checkstack/auth-common";
import { ResourcePickerCombobox } from "./ResourcePickerCombobox";

interface Grant {
  resourceType: string;
  resourceId: string;
  canRead: boolean;
  canManage: boolean;
}

export interface TeamResourceGrantsEditorProps {
  teamId: string;
  /** Whether the current user may change grants (server enforces too). */
  canManage: boolean;
}

/**
 * Per-resource-type group: resolves the opaque grant ids to display names (one
 * query per type, so the parent can render one group per type without a
 * hooks-in-loop), then renders each grant by name with editable level + revoke.
 */
const GrantTypeGroup: React.FC<{
  teamId: string;
  resourceType: string;
  label: string;
  grants: Grant[];
  canManage: boolean;
  onChanged: () => void;
}> = ({ teamId, resourceType, label, grants, canManage, onChanged }) => {
  const authClient = usePluginClient(AuthApi);
  const toast = useToast();

  const { data: nameData } = authClient.resolveResourceNames.useQuery({
    resourceType,
    resourceIds: grants.map((g) => g.resourceId),
  });
  const names = nameData?.names ?? {};

  const setAccess = authClient.writeRelation.useMutation({
    onSuccess: onChanged,
    onError: (e) => toastError(toast, "Failed to update", e),
  });
  const removeAccess = authClient.removeRelation.useMutation({
    onSuccess: onChanged,
    onError: (e) => toastError(toast, "Failed to revoke", e),
  });

  const nameFor = (id: string) => names[id] ?? id;

  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="space-y-1">
        {grants
          .toSorted((a, b) => nameFor(a.resourceId).localeCompare(nameFor(b.resourceId)))
          .map((g) => (
            <div
              key={g.resourceId}
              className="flex items-center justify-between gap-2 rounded-md bg-surface-inset p-2 text-sm"
            >
              <span className="min-w-0 flex-1 truncate" title={nameFor(g.resourceId)}>
                {nameFor(g.resourceId)}
              </span>
              {canManage ? (
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Checkbox
                      checked={g.canManage}
                      onCheckedChange={(checked) =>
                        setAccess.mutate({
                          objectType: resourceType,
                          objectId: g.resourceId,
                          teamId,
                          relation: checked ? "editor" : "viewer",
                        })
                      }
                      aria-label={`${nameFor(g.resourceId)} can change`}
                    />
                    <Settings className="h-3 w-3" /> Manage
                  </label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      removeAccess.mutate({
                        objectType: resourceType,
                        objectId: g.resourceId,
                        teamId,
                      })
                    }
                    aria-label={`Revoke access to ${nameFor(g.resourceId)}`}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ) : (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  {g.canManage ? (
                    <>
                      <Settings className="h-3 w-3" /> Manage
                    </>
                  ) : (
                    <>
                      <Eye className="h-3 w-3" /> Read
                    </>
                  )}
                </span>
              )}
            </div>
          ))}
      </div>
    </div>
  );
};

/**
 * Editable view of a team's resource grants, shown on the Teams page. Lists
 * grants BY NAME (resolved cross-plugin) grouped by type; an admin can change a
 * grant's level, revoke it, or add a new one via a resource picker. Granting is
 * gated on `auth.teams.manage` (admin); non-admins see a read-only list.
 */
export const TeamResourceGrantsEditor: React.FC<
  TeamResourceGrantsEditorProps
> = ({ teamId, canManage }) => {
  const authClient = usePluginClient(AuthApi);
  const toast = useToast();
  const [addType, setAddType] = useState<string>("");

  const {
    data: grantsData,
    isLoading,
    isError,
    refetch,
  } = authClient.listSubjectRelations.useQuery({ teamId });
  const { data: kindsData } = authClient.getResourceKinds.useQuery({});

  const addGrant = authClient.writeRelation.useMutation({
    onSuccess: () => {
      toast.success("Access granted");
      void refetch();
    },
    onError: (e) => toastError(toast, "Failed to grant access", e),
  });

  const header = (
    <Label className="flex items-center gap-1.5">
      <ShieldCheck className="h-3.5 w-3.5" />
      Resource access
    </Label>
  );

  if (isLoading) {
    return (
      <div className="space-y-2 border-t pt-4">
        {header}
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoadingSpinner /> Loading access...
        </div>
      </div>
    );
  }
  if (isError) {
    return (
      <div className="space-y-2 border-t pt-4">
        {header}
        <div className="flex items-center gap-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" /> Couldn&apos;t load access.
        </div>
      </div>
    );
  }

  // Map the relation tuples to the local Grant shape the group rows render:
  // objectType -> resourceType, objectId -> resourceId, and read/manage derived
  // from the relation (any relation grants read; editor/owner also manage).
  const grants: Grant[] = (grantsData?.grants ?? []).map((g) => ({
    resourceType: g.objectType,
    resourceId: g.objectId,
    canRead: true,
    canManage: g.relation !== "viewer",
  }));
  const kinds = kindsData?.kinds ?? [];
  const labelByType = new Map(kinds.map((k) => [k.resourceType, k.label]));
  const labelFor = (t: string) => labelByType.get(t) ?? t;

  const groups = new Map<string, Grant[]>();
  for (const g of grants) {
    const list = groups.get(g.resourceType) ?? [];
    list.push(g);
    groups.set(g.resourceType, list);
  }
  const groupRows = [...groups.entries()].toSorted(([a], [b]) =>
    a.localeCompare(b),
  );

  // Resource types you can grant: every team-scopable kind that has a resolver
  // is implicitly supported; we offer all kinds and let the picker come up empty
  // for types without a resolver.
  const grantableKinds = kinds;
  const excludeIdsForAddType = grants
    .filter((g) => g.resourceType === addType)
    .map((g) => g.resourceId);

  return (
    <div className="space-y-3 border-t pt-4">
      {header}

      {groupRows.length === 0 ? (
        <p className="text-sm italic text-muted-foreground">
          This team has no resource grants yet.
          {canManage ? " Add one below." : ""}
        </p>
      ) : (
        <div className="space-y-3">
          {groupRows.map(([resourceType, typeGrants]) => (
            <GrantTypeGroup
              key={resourceType}
              teamId={teamId}
              resourceType={resourceType}
              label={labelFor(resourceType)}
              grants={typeGrants}
              canManage={canManage}
              onChanged={() => void refetch()}
            />
          ))}
        </div>
      )}

      {canManage && (
        <div className="space-y-2 rounded-md border border-dashed p-2">
          <p className="text-xs font-medium">Grant access to a resource</p>
          <div className="flex gap-2">
            <Select value={addType} onValueChange={setAddType}>
              <SelectTrigger className="w-44" aria-label="Resource type">
                <SelectValue placeholder="Resource type" />
              </SelectTrigger>
              <SelectContent>
                {grantableKinds.map((k) => (
                  <SelectItem key={k.resourceType} value={k.resourceType}>
                    {k.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <ResourcePickerCombobox
              resourceType={addType}
              excludeIds={excludeIdsForAddType}
              disabled={!addType || addGrant.isPending}
              onSelect={(resource) =>
                addGrant.mutate({
                  objectType: addType,
                  objectId: resource.id,
                  teamId,
                  relation: "editor",
                })
              }
            />
          </div>
          <p className="text-[11px] text-muted-foreground">
            Pick a type, then search for the resource. The team gets Manage
            (members can view and change it, even without the global
            permission); untick Manage above for read-only (view only). Anyone
            who can already read it still can.
          </p>
        </div>
      )}
    </div>
  );
};
