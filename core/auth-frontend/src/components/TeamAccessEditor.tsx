import React, { useState } from "react";
import {
  Card,
  CardHeader,
  CardHeaderRow,
  CardTitle,
  CardContent,
  Button,
  Badge,
  useToast,
  LoadingSpinner,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Checkbox,
  Toggle,
} from "@checkstack/ui";
import {
  Plus,
  Trash2,
  Users2,
  Shield,
  Settings,
  Lock,
  AlertCircle,
} from "lucide-react";
import {
  useApi,
  usePluginClient,
  accessApiRef,
} from "@checkstack/frontend-api";
import { AuthApi, authAccess } from "@checkstack/auth-common";
import { extractErrorMessage } from "@checkstack/common";
import { deriveTeamAccessSummary } from "../lib/deriveTeamAccessSummary";

interface TeamAccess {
  teamId: string;
  teamName: string;
  canRead: boolean;
  canManage: boolean;
}

interface Team {
  id: string;
  name: string;
  description?: string | null;
  memberCount: number;
  isManager: boolean;
}

export interface TeamAccessEditorProps {
  /** Resource type identifier (e.g., "catalog.system", "healthcheck.configuration") */
  resourceType: string;
  /** Resource ID */
  resourceId: string;
  /** Whether the editor is expanded/visible */
  expanded?: boolean;
  /** Compact mode for inline display */
  compact?: boolean;
  /** Called when access is modified */
  onChange?: () => void;
}

/**
 * Reusable component for managing team-based access to resources.
 *
 * Model: a team grant controls who can CHANGE a resource — read stays global
 * unless "Private to teams" (teamOnly) is on. So adding a team here (which
 * defaults to Manage) lets that team change the resource while everyone who can
 * already read it still can.
 *
 * Used in System editor, Health Check editor, Incident/Maintenance forms.
 */
export const TeamAccessEditor: React.FC<TeamAccessEditorProps> = ({
  resourceType,
  resourceId,
  expanded: initialExpanded = false,
  compact = false,
  onChange,
}) => {
  const accessApi = useApi(accessApiRef);
  const authClient = usePluginClient(AuthApi);
  const toast = useToast();

  const { allowed: canManageTeams } = accessApi.useAccess(
    authAccess.teams.manage,
  );

  const [expanded, setExpanded] = useState(initialExpanded);
  const [selectedTeamId, setSelectedTeamId] = useState("");

  // Query: relation tuples + public marker for this object. One generic
  // endpoint replaces the old per-concept access + settings queries.
  const {
    data: relations,
    isLoading: relationsLoading,
    isError: relationsError,
    refetch: refetchRelations,
  } = authClient.listObjectRelations.useQuery(
    { objectType: resourceType, objectId: resourceId },
    { enabled: expanded && !!resourceId },
  );

  // Query: All teams
  const {
    data: teams = [],
    isLoading: teamsLoading,
    isError: teamsError,
  } = authClient.getTeams.useQuery({}, { enabled: expanded && !!resourceId });

  const loading = relationsLoading || teamsLoading;
  // An access-control surface MUST distinguish "failed to load" from "no
  // restrictions" — otherwise a fetch error makes a restricted resource look open.
  const hasError = relationsError || teamsError;
  // Map relation tuples to the read/manage shape the editor renders: any
  // relation grants read; editor/owner also grant manage. Privacy is the
  // inverse of the public marker.
  const accessList: TeamAccess[] = (relations?.teams ?? []).map((t) => ({
    teamId: t.teamId,
    teamName: t.teamName,
    canRead: true,
    canManage: t.relation !== "viewer",
  }));
  const teamOnly = relations ? !relations.isPublic : false;

  // Mutations
  const setAccessMutation = authClient.writeRelation.useMutation({
    onSuccess: () => {
      toast.success("Team access updated");
      setSelectedTeamId("");
      void refetchRelations();
      onChange?.();
    },
    onError: (error) => {
      toast.error(extractErrorMessage(error, "Failed to update access"));
    },
  });

  const removeAccessMutation = authClient.removeRelation.useMutation({
    onSuccess: () => {
      toast.success("Team access removed");
      void refetchRelations();
      onChange?.();
    },
    onError: (error) => {
      toast.error(extractErrorMessage(error, "Failed to remove access"));
    },
  });

  const setSettingsMutation = authClient.setObjectPublic.useMutation({
    onSuccess: () => {
      void refetchRelations();
      onChange?.();
    },
    onError: (error) => {
      toast.error(extractErrorMessage(error, "Failed to update settings"));
    },
  });

  const handleAddTeam = () => {
    if (!selectedTeamId) return;
    // Default a newly-added team to MANAGE: the reason to scope a resource to a
    // team is to let that team change it (read is already global). Read-only is
    // a deliberate downgrade via the checkbox below. manage -> "editor".
    setAccessMutation.mutate({
      objectType: resourceType,
      objectId: resourceId,
      teamId: selectedTeamId,
      relation: "editor",
    });
  };

  const handleUpdateAccess = (teamId: string, canManage: boolean) => {
    // A team always retains read; the only meaningful distinction is the manage
    // bit, which maps to editor (manage) vs viewer (read-only).
    setAccessMutation.mutate({
      objectType: resourceType,
      objectId: resourceId,
      teamId,
      relation: canManage ? "editor" : "viewer",
    });
  };

  const handleUpdateSettings = (newTeamOnly: boolean) => {
    setSettingsMutation.mutate({
      objectType: resourceType,
      objectId: resourceId,
      isPublic: !newTeamOnly,
    });
  };

  const handleRemoveAccess = (teamId: string) => {
    removeAccessMutation.mutate({
      objectType: resourceType,
      objectId: resourceId,
      teamId,
    });

    // If this was the last team, turn off "Private to teams" so the resource
    // doesn't end up locked-down with no team able to reach it. Surface it.
    const remainingTeams = accessList.filter((a) => a.teamId !== teamId);
    if (remainingTeams.length === 0 && teamOnly) {
      setSettingsMutation.mutate({
        objectType: resourceType,
        objectId: resourceId,
        isPublic: true,
      });
      toast.info("Private turned off — no teams remain");
    }
  };

  const typedAccessList = accessList;
  const availableTeams = (teams as Team[]).filter(
    (t) => !typedAccessList.some((a) => a.teamId === t.id),
  );
  const adding = setAccessMutation.isPending;

  // A plain-language summary of the current effective access, always visible so
  // the "manage vs read" model is legible in the UI (not just the docs).
  // Derived via the shared helper so the read-only ResourceManagedBy indicator
  // stays semantically identical.
  const summary = deriveTeamAccessSummary({
    accessList: typedAccessList,
    teamOnly,
  });
  const statusText = (() => {
    switch (summary.kind) {
      case "open": {
        return "Not scoped to a team. Anyone with access can view it; changing it needs the global manage permission. Add a team to let that team change it.";
      }
      case "private": {
        return `Private to teams — only ${summary.teams.join(", ")} can view or change this.`;
      }
      case "managed": {
        return `Readable by anyone with read access. Managed by ${summary.managingTeams.join(", ")}.`;
      }
      case "readonly-grants": {
        return "Readable by anyone with read access. The added team(s) are read-only, so no team can change this yet.";
      }
    }
  })();

  // Compact summary mode (collapsed button)
  if (!expanded) {
    return (
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setExpanded(true)}
          className="gap-1.5"
        >
          <Users2 className="h-4 w-4" />
          <span>Who can change this</span>
          {typedAccessList.length > 0 && (
            <Badge variant="secondary" className="ml-1">
              {typedAccessList.length}
            </Badge>
          )}
        </Button>
      </div>
    );
  }

  const errorState = (
    <div className="flex items-center gap-2 text-sm text-destructive py-2">
      <AlertCircle className="h-4 w-4" />
      Couldn&apos;t load team access. Retry or reopen the editor.
    </div>
  );

  // Shared status banner.
  const statusBanner = (
    <p className="text-xs text-muted-foreground bg-muted/30 rounded-md p-2">
      {statusText}
    </p>
  );

  // Shared "Private" row. Always visible so the privacy control is discoverable
  // (it used to be hidden until a team was added). It is disabled to enable when
  // turning it on would strand the resource: with NO team at all (nobody could
  // reach it), or when teams exist but none can Manage (only a platform admin
  // could then change it). Turning it OFF is always allowed.
  const noTeamsYet = typedAccessList.length === 0;
  const noManagerYet = summary.kind === "readonly-grants";
  const privateRow = (
    <div className="flex items-center justify-between p-2 bg-muted/30 rounded-md">
      <div className="flex items-center gap-2">
        <Lock className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm">Private</span>
        <span className="text-xs text-muted-foreground">
          {noTeamsYet
            ? "(add a team first to hide this from everyone else)"
            : noManagerYet
              ? "(give a team Manage before making this private)"
              : "(hide from everyone else — only the team(s) above can see it)"}
        </span>
      </div>
      <Toggle
        checked={teamOnly}
        onCheckedChange={handleUpdateSettings}
        disabled={!canManageTeams || noTeamsYet || (noManagerYet && !teamOnly)}
        aria-label="Private (hide from everyone else)"
      />
    </div>
  );

  // Shared add-team row.
  const addRow = canManageTeams && (
    <div className="flex gap-2">
      <Select value={selectedTeamId} onValueChange={setSelectedTeamId}>
        <SelectTrigger className="flex-1">
          <SelectValue placeholder="Add a team that can change this" />
        </SelectTrigger>
        <SelectContent>
          {availableTeams.length === 0 ? (
            <SelectItem value="_none" disabled>
              No teams available
            </SelectItem>
          ) : (
            availableTeams.map((team) => (
              <SelectItem key={team.id} value={team.id}>
                {team.name}
              </SelectItem>
            ))
          )}
        </SelectContent>
      </Select>
      <Button
        type="button"
        onClick={handleAddTeam}
        disabled={!selectedTeamId || adding}
        size="sm"
      >
        <Plus className="h-4 w-4" />
      </Button>
    </div>
  );

  // Shared, keyboard-accessible access row. ONE control — the Manage checkbox —
  // because every scoped team can read; the only real decision is whether they
  // can also change it. (Same single-control vocabulary as the Teams-page grant
  // editor, so the two surfaces match.) Unchecked = read-only.
  const accessRow = (access: TeamAccess) => (
    <div
      key={access.teamId}
      className="flex items-center justify-between gap-2 p-2 bg-muted/50 rounded-md"
    >
      <div className="flex items-center gap-2 min-w-0">
        <Users2 className="h-4 w-4 text-muted-foreground shrink-0" />
        <span className="font-medium text-sm truncate">{access.teamName}</span>
        {!access.canManage && (
          <span className="text-xs text-muted-foreground shrink-0">
            (read-only)
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Checkbox
            checked={access.canManage}
            onCheckedChange={(checked) =>
              handleUpdateAccess(access.teamId, !!checked)
            }
            disabled={!canManageTeams}
            aria-label={`${access.teamName} can change this`}
          />
          <Settings className="h-3 w-3" />
          Manage
        </label>
        {canManageTeams && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => handleRemoveAccess(access.teamId)}
            aria-label={`Remove ${access.teamName} access`}
          >
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        )}
      </div>
    </div>
  );

  const body = loading ? (
    <div className="flex justify-center py-4">
      <LoadingSpinner />
    </div>
  ) : hasError ? (
    errorState
  ) : (
    <>
      {statusBanner}
      {privateRow}
      {addRow}
      <div className="space-y-2">
        {typedAccessList.map((a) => accessRow(a))}
      </div>
      <p className="text-xs text-muted-foreground">
        Every team added here can <strong>view</strong> this resource, even
        members who don&apos;t have the global read permission. Tick{" "}
        <strong>Manage</strong> to also let them change it. Anyone who can
        already read it still can.
      </p>
    </>
  );

  // Compact inline mode
  if (compact) {
    return (
      <div className="border rounded-lg p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium text-sm">Who can change this</span>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setExpanded(false)}
          >
            Collapse
          </Button>
        </div>
        {body}
      </div>
    );
  }

  // Card mode (default)
  return (
    <Card>
      <CardHeader>
        <CardHeaderRow>
          <CardTitle className="text-base flex items-center gap-2">
            <Shield className="h-4 w-4" />
            Who can change this
          </CardTitle>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setExpanded(false)}
          >
            Collapse
          </Button>
        </CardHeaderRow>
      </CardHeader>
      <CardContent className="space-y-4">{body}</CardContent>
    </Card>
  );
};

export default TeamAccessEditor;
