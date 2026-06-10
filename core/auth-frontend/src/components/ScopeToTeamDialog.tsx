import React, { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Label,
  useToast,
} from "@checkstack/ui";
import { usePluginClient } from "@checkstack/frontend-api";
import { AuthApi } from "@checkstack/auth-common";
import { extractErrorMessage } from "@checkstack/common";

export interface ScopeToTeamDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Qualified resource type, e.g. "catalog.system". */
  resourceType: string;
  /** The resources to scope (id + display name). */
  resources: Array<{ id: string; name: string }>;
  /** Called after a (fully or partially) successful apply, e.g. to clear selection. */
  onApplied?: () => void;
}

type Level = "manage" | "read";

/**
 * Additive bulk/single "scope these resources to a team" dialog. Grants the
 * chosen team Manage (default) or Read on every given resource — the resources
 * stay globally readable (this never sets teamOnly; privacy stays per-resource
 * in the Team access editor). Write-only and additive, so it can never present
 * a model that diverges from the per-resource editor.
 */
export const ScopeToTeamDialog: React.FC<ScopeToTeamDialogProps> = ({
  open,
  onOpenChange,
  resourceType,
  resources,
  onApplied,
}) => {
  const authClient = usePluginClient(AuthApi);
  const toast = useToast();
  const [teamId, setTeamId] = useState("");
  const [level, setLevel] = useState<Level>("manage");
  const [applying, setApplying] = useState(false);
  // How many resources have been written so far this apply (drives the progress
  // label, since this is a sequential N-request operation).
  const [done, setDone] = useState(0);

  const { data: teams = [] } = authClient.getTeams.useQuery(
    {},
    { enabled: open },
  );
  const setAccess = authClient.writeRelation.useMutation();

  const teamName = teams.find((t) => t.id === teamId)?.name ?? "the team";
  const count = resources.length;

  const handleApply = async () => {
    if (!teamId || count === 0) return;
    setApplying(true);
    setDone(0);
    let failures = 0;
    for (const resource of resources) {
      try {
        await setAccess.mutateAsync({
          objectType: resourceType,
          objectId: resource.id,
          teamId,
          relation: level === "manage" ? "editor" : "viewer",
        });
      } catch {
        failures += 1;
      }
      setDone((d) => d + 1);
    }
    setApplying(false);

    const ok = count - failures;
    if (failures === 0) {
      toast.success(
        `Scoped ${ok} ${ok === 1 ? "resource" : "resources"} to ${teamName}`,
      );
    } else if (ok > 0) {
      toast.error(`Scoped ${ok} of ${count}; ${failures} failed`);
    } else {
      toast.error(
        extractErrorMessage(setAccess.error, "Couldn't scope to team"),
      );
    }

    if (ok > 0) {
      onApplied?.();
      onOpenChange(false);
      setTeamId("");
      setLevel("manage");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Scope {count} {count === 1 ? "resource" : "resources"} to a team
          </DialogTitle>
          <DialogDescription>
            Give a team access to these resources. The team&apos;s members can
            reach them even without the global permission; this never removes
            anyone&apos;s existing access.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Team</Label>
            <Select value={teamId} onValueChange={setTeamId}>
              <SelectTrigger>
                <SelectValue placeholder="Select a team" />
              </SelectTrigger>
              <SelectContent>
                {teams.length === 0 ? (
                  <SelectItem value="_none" disabled>
                    No teams available
                  </SelectItem>
                ) : (
                  teams.map((team) => (
                    <SelectItem key={team.id} value={team.id}>
                      {team.name}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Access level</Label>
            <Select
              value={level}
              onValueChange={(v) => setLevel(v as Level)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="manage">Manage (can change)</SelectItem>
                <SelectItem value="read">Read-only (can view)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {teamId && (
            <p className="text-sm text-muted-foreground">
              <strong>{teamName}</strong>&apos;s members will be able to{" "}
              {level === "manage" ? "view and change" : "view"} {count}{" "}
              {count === 1 ? "resource" : "resources"}, even members who
              don&apos;t have the global permission
              {level === "read" ? ", but not change them" : ""}. Anyone who can
              already read them still can. To hide a resource from everyone
              outside its team, open it and use &quot;Who can change this&quot;.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={applying}
          >
            Cancel
          </Button>
          <Button
            onClick={handleApply}
            disabled={!teamId || count === 0 || applying}
          >
            {applying
              ? count > 1
                ? `Scoping ${done}/${count}...`
                : "Scoping..."
              : "Scope to team"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
