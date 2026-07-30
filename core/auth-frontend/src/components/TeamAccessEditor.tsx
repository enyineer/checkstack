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
  toastError,
  LoadingSpinner,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Checkbox,
  Toggle,
  ConfirmationModal,
} from "@checkstack/ui";
import {
  Plus,
  Trash2,
  Users2,
  Shield,
  Lock,
  AlertCircle,
  ExternalLink,
} from "lucide-react";
import { Link } from "react-router";
import { useApi, usePluginClient, accessApiRef } from "@checkstack/frontend-api";
import { AuthApi, authAccess, authRoutes } from "@checkstack/auth-common";
import { resolveRoute } from "@checkstack/common";
import { deriveTeamAccessSummary } from "../lib/deriveTeamAccessSummary";
import { isSelfRevokingChange } from "../lib/selfLockout";

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
  /** Resource type identifier (e.g., "catalog.system", "healthcheck.healthcheck") */
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
  const authClient = usePluginClient(AuthApi);
  const accessApi = useApi(accessApiRef);
  const toast = useToast();

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

  // Whether THIS caller may EDIT the object's team access. Runs the same
  // delegation authz as the write procedures (global teams-admin, the object's
  // own manage rule, or membership of a team that manages this object), so the
  // write controls appear exactly when a write would be accepted - a read-only
  // viewer sees the grants but no add/remove/Manage/Private controls, and cannot
  // elevate. The backend re-checks on every write, so this is UX only.
  const { data: editVerdict } = authClient.canManageObjectAccess.useQuery(
    { objectType: resourceType, objectId: resourceId },
    { enabled: expanded && !!resourceId },
  );
  const canEdit = editVerdict?.allowed ?? false;

  // The caller's OWN teams, to warn before they revoke their own access (below).
  // `getMyTeams` carries no access rule - a caller may always read their own
  // memberships - so this is safe for every principal that can open the editor.
  const { data: myTeamsData } = authClient.getMyTeams.useQuery(undefined, {
    enabled: expanded && !!resourceId,
  });
  const myTeamIds = new Set((myTeamsData?.teams ?? []).map((t) => t.id));

  // A global `auth.teams.manage` admin can always restore a grant they removed,
  // so the self-lockout warning is for everyone EXCEPT them.
  const { allowed: isGlobalTeamsAdmin } = accessApi.useAccess(
    authAccess.teams.manage,
  );

  /** A confirmation the user must accept before a self-revoking change runs. */
  const [pendingSelfRevoke, setPendingSelfRevoke] = useState<{
    teamName: string;
    apply: () => void;
  }>();

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

  /** See `isSelfRevokingChange` - pure, unit-tested in `selfLockout.test.ts`. */
  const isSelfLockout = (teamId: string): boolean =>
    isSelfRevokingChange({
      teamId,
      grants: accessList,
      myTeamIds,
      isGlobalTeamsAdmin,
    });

  // Mutations
  const setAccessMutation = authClient.writeRelation.useMutation({
    onSuccess: () => {
      toast.success("Team access updated");
      setSelectedTeamId("");
      void refetchRelations();
      onChange?.();
    },
    onError: (error) => {
      toastError(toast, "Failed to update access", error);
    },
  });

  const removeAccessMutation = authClient.removeRelation.useMutation({
    onSuccess: () => {
      toast.success("Team access removed");
      void refetchRelations();
      onChange?.();
    },
    onError: (error) => {
      toastError(toast, "Failed to remove access", error);
    },
  });

  const setSettingsMutation = authClient.setObjectPublic.useMutation({
    onSuccess: () => {
      void refetchRelations();
      onChange?.();
    },
    onError: (error) => {
      toastError(toast, "Failed to update settings", error);
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
    const apply = () =>
      setAccessMutation.mutate({
        objectType: resourceType,
        objectId: resourceId,
        teamId,
        relation: canManage ? "editor" : "viewer",
      });

    // Downgrading YOUR OWN team to read-only can strand you: you would no longer
    // be able to change this resource, nor restore the grant. Confirm first.
    if (!canManage && isSelfLockout(teamId)) {
      const teamName =
        accessList.find((a) => a.teamId === teamId)?.teamName ?? "your team";
      setPendingSelfRevoke({ teamName, apply });
      return;
    }
    apply();
  };

  const handleUpdateSettings = (newTeamOnly: boolean) => {
    setSettingsMutation.mutate({
      objectType: resourceType,
      objectId: resourceId,
      isPublic: !newTeamOnly,
    });
  };

  const handleRemoveAccess = (teamId: string) => {
    const apply = () => {
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
        toast.info("Private turned off - no teams remain");
      }
    };

    // Removing YOUR OWN team's only Manage grant is a one-way door - confirm.
    if (isSelfLockout(teamId)) {
      const teamName =
        accessList.find((a) => a.teamId === teamId)?.teamName ?? "your team";
      setPendingSelfRevoke({ teamName, apply });
      return;
    }
    apply();
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
        return `Private to teams - only ${summary.teams.join(", ")} can view or change this.`;
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
    <p className="text-xs text-muted-foreground bg-surface-inset rounded-md p-2">
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
    <div className="flex items-center justify-between p-2 bg-surface-inset rounded-md">
      <div className="flex items-center gap-2">
        <Lock className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm">Private</span>
        <span className="text-xs text-muted-foreground">
          {noTeamsYet
            ? "(add a team first to hide this from everyone else)"
            : noManagerYet
              ? "(give a team Manage before making this private)"
              : "(hide from everyone else - only the team(s) above can see it)"}
        </span>
      </div>
      <Toggle
        checked={teamOnly}
        onCheckedChange={handleUpdateSettings}
        disabled={!canEdit || noTeamsYet || (noManagerYet && !teamOnly)}
        aria-label="Private (hide from everyone else)"
      />
    </div>
  );

  // Shared add-team row.
  const addRow = canEdit && (
    <div className="flex gap-2">
      <Select value={selectedTeamId} onValueChange={setSelectedTeamId}>
        <SelectTrigger className="flex-1" aria-label="Add a team that can change this">
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
      className="flex items-center justify-between gap-2 p-2 bg-surface-inset rounded-md"
    >
      <div className="flex items-center gap-2 min-w-0">
        <Users2 className="h-4 w-4 text-muted-foreground shrink-0" />
        {/* The team NAME navigates to the team itself (members/managers). This
            is the "take me to the team" affordance - keeping it separate from
            the checkbox, which only sets this resource's grant level. Before,
            the checkbox's gear icon made people expect it to open the team. */}
        <Link
          to={`${resolveRoute(authRoutes.routes.teams)}?team=${access.teamId}`}
          className="font-medium text-sm truncate hover:underline inline-flex items-center gap-1"
          title={`Open ${access.teamName} to manage its members`}
        >
          <span className="truncate">{access.teamName}</span>
          <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />
        </Link>
        {!access.canManage && (
          <span className="text-xs text-muted-foreground shrink-0">
            (read-only)
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {/* Labelled by its EFFECT on this resource ("Can edit"), not "Manage" -
            the old wording plus a gear icon read as "manage the team". */}
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Checkbox
            checked={access.canManage}
            onCheckedChange={(checked) =>
              handleUpdateAccess(access.teamId, !!checked)
            }
            disabled={!canEdit}
            aria-label={`${access.teamName} can edit this resource`}
          />
          Can edit
        </label>
        {canEdit && (
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
        <strong>Can edit</strong> to also let them change it. Anyone who can
        already read it still can. Select a team name to manage its members.
      </p>

      {/* Self-lockout guard: revoking your OWN team's only edit grant cannot be
          undone by you afterwards, so it is confirmed rather than instant. */}
      <ConfirmationModal
        isOpen={!!pendingSelfRevoke}
        onClose={() => setPendingSelfRevoke(undefined)}
        onConfirm={() => {
          pendingSelfRevoke?.apply();
          setPendingSelfRevoke(undefined);
        }}
        title="Remove your own team's access?"
        message={`${pendingSelfRevoke?.teamName ?? "Your team"} is the only team of yours that can edit this resource. If you continue you will no longer be able to change it — or to restore this permission yourself. An administrator would have to grant it back.`}
        confirmText="Remove access"
        variant="warning"
      />
    </>
  );

  // Compact inline mode
  if (compact) {
    return (
      // bg-card, not transparent: this container renders directly on page
      // backdrops (detail pages have a decorative grid) - a bordered box
      // without its own opaque background lets the backdrop bleed through
      // the content (see .claude/rules/code-style-guide.md, opaque surfaces).
      <div className="border rounded-lg p-4 space-y-4 bg-card">
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
