import React, { useState, useEffect } from "react";
import { useSearchParams } from "react-router";
import {
  Card,
  CardHeader,
  CardHeaderRow,
  CardTitle,
  CardContent,
  DataTable,
  type DataTableColumn,
  Button,
  RowActions,
  RowAction,
  Badge,
  ConfirmationModal,
  useToast,
  toastError,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  Input,
  Label,
  Textarea,
  LoadingSpinner,
} from "@checkstack/ui";
import { Plus, Edit, Trash2, Users2, Crown, UserMinus } from "lucide-react";
import { usePluginClient } from "@checkstack/frontend-api";
import { AuthApi } from "@checkstack/auth-common";
import { TeamCreateGrantsEditor } from "./TeamCreateGrantsEditor";
import { TeamResourceGrantsEditor } from "./TeamResourceGrantsEditor";
import { UserPickerCombobox } from "./UserPickerCombobox";

interface Team {
  id: string;
  name: string;
  description?: string | null;
  memberCount: number;
  isManager: boolean;
}

interface TeamDetail {
  id: string;
  name: string;
  description?: string | null;
  members: Array<{ id: string; name: string; email: string }>;
  managers: Array<{ id: string; name: string; email: string }>;
}

export interface TeamsTabProps {
  canReadTeams: boolean;
  canManageTeams: boolean;
  onDataChange: () => Promise<void>;
}

export const TeamsTab: React.FC<TeamsTabProps> = ({
  canReadTeams,
  canManageTeams,
  onDataChange,
}) => {
  const authClient = usePluginClient(AuthApi);
  const toast = useToast();

  const [teamToDelete, setTeamToDelete] = useState<string>();
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingTeam, setEditingTeam] = useState<Team | undefined>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [membersDialogOpen, setMembersDialogOpen] = useState(false);
  const [selectedTeamId, setSelectedTeamId] = useState<string>();

  // Team form state
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");

  // Query: Teams list
  const {
    data: teams = [],
    isLoading: loading,
    refetch: refetchTeams,
  } = authClient.getTeams.useQuery({}, { enabled: canReadTeams });

  // Query: Team detail (for members dialog)
  const {
    data: selectedTeamDetail,
    isLoading: membersLoading,
    refetch: refetchTeamDetail,
  } = authClient.getTeam.useQuery(
    { teamId: selectedTeamId ?? "" },
    { enabled: !!selectedTeamId && membersDialogOpen },
  );

  // Mutations
  const createTeamMutation = authClient.createTeam.useMutation({
    onSuccess: () => {
      toast.success("Team created successfully");
      setEditDialogOpen(false);
      void refetchTeams();
      void onDataChange();
    },
    onError: (error) => {
      toastError(toast, "Failed to create team", error);
    },
  });

  const updateTeamMutation = authClient.updateTeam.useMutation({
    onSuccess: () => {
      toast.success("Team updated successfully");
      setEditDialogOpen(false);
      void refetchTeams();
      void onDataChange();
    },
    onError: (error) => {
      toastError(toast, "Failed to update team", error);
    },
  });

  const deleteTeamMutation = authClient.deleteTeam.useMutation({
    onSuccess: () => {
      toast.success("Team deleted successfully");
      setTeamToDelete(undefined);
      void refetchTeams();
      void onDataChange();
    },
    onError: (error) => {
      toastError(toast, "Failed to delete team", error);
    },
  });

  const addMemberMutation = authClient.addUserToTeam.useMutation({
    onSuccess: () => {
      toast.success("Member added successfully");
      void refetchTeamDetail();
      void refetchTeams();
    },
    onError: (error) => {
      toastError(toast, "Failed to add member", error);
    },
  });

  const removeMemberMutation = authClient.removeUserFromTeam.useMutation({
    onSuccess: () => {
      toast.success("Member removed");
      void refetchTeamDetail();
      void refetchTeams();
    },
    onError: (error) => {
      toastError(toast, "Failed to remove member", error);
    },
  });

  const addManagerMutation = authClient.addTeamManager.useMutation({
    onSuccess: () => {
      toast.success("Member promoted to manager");
      void refetchTeamDetail();
    },
    onError: (error) => {
      toastError(toast, "Failed to promote to manager", error);
    },
  });

  const removeManagerMutation = authClient.removeTeamManager.useMutation({
    onSuccess: () => {
      toast.success("Manager role removed");
      void refetchTeamDetail();
    },
    onError: (error) => {
      toastError(toast, "Failed to remove manager role", error);
    },
  });

  // Reset form when dialog closes
  useEffect(() => {
    if (!editDialogOpen) {
      setEditingTeam(undefined);
      setFormName("");
      setFormDescription("");
    }
  }, [editDialogOpen]);

  // Reset selected team when members dialog closes
  useEffect(() => {
    if (!membersDialogOpen) {
      setSelectedTeamId(undefined);
    }
  }, [membersDialogOpen]);

  const handleCreateTeam = () => {
    setEditingTeam(undefined);
    setFormName("");
    setFormDescription("");
    setEditDialogOpen(true);
  };

  const handleEditTeam = (team: Team) => {
    setEditingTeam(team);
    setFormName(team.name);
    setFormDescription(team.description ?? "");
    setEditDialogOpen(true);
  };

  const handleSaveTeam = () => {
    if (!formName.trim()) {
      toast.error("Team name is required");
      return;
    }

    if (editingTeam) {
      updateTeamMutation.mutate({
        id: editingTeam.id,
        name: formName,
        description: formDescription || undefined,
      });
    } else {
      createTeamMutation.mutate({
        name: formName,
        description: formDescription || undefined,
      });
    }
  };

  const handleDeleteTeam = () => {
    if (!teamToDelete) return;
    deleteTeamMutation.mutate(teamToDelete);
  };

  const openMembersDialog = (teamId: string) => {
    setSelectedTeamId(teamId);
    setMembersDialogOpen(true);
  };

  // Deep link: `/teams?team=<id>` opens that team's members dialog directly, so
  // the team name in a resource's "Who can change this" editor can take you
  // straight to the team instead of dropping you on an unfiltered list. The
  // param is cleared once consumed so closing the dialog doesn't reopen it, and
  // it only fires for a team actually present in the (access-scoped) list.
  useEffect(() => {
    const requested = searchParams.get("team");
    if (!requested) return;
    if (!teams.some((t) => t.id === requested)) return;
    setSelectedTeamId(requested);
    setMembersDialogOpen(true);
    const next = new URLSearchParams(searchParams);
    next.delete("team");
    setSearchParams(next, { replace: true });
  }, [searchParams, teams, setSearchParams]);

  const handleAddMember = (userId: string) => {
    if (!selectedTeamId) return;
    addMemberMutation.mutate({
      teamId: selectedTeamId,
      userId,
    });
  };

  const handleRemoveMember = (userId: string) => {
    if (!selectedTeamId) return;
    removeMemberMutation.mutate({
      teamId: selectedTeamId,
      userId,
    });
  };

  const handleToggleManager = (userId: string, isCurrentlyManager: boolean) => {
    if (!selectedTeamId) return;

    if (isCurrentlyManager) {
      removeManagerMutation.mutate({
        teamId: selectedTeamId,
        userId,
      });
    } else {
      addManagerMutation.mutate({
        teamId: selectedTeamId,
        userId,
      });
    }
  };

  // Get users not already in the team
  const teamDetailData = selectedTeamDetail as TeamDetail | undefined;
  // A global manager OR a manager of THIS team may manage its members/managers
  // (matches the backend: membership/manager mutations require teams.read +
  // assertTeamManagementAccess). Create/delete team stay global-only.
  const teamList = teams as Team[];
  const canManageThisTeam =
    canManageTeams ||
    (teamList.find((t) => t.id === selectedTeamId)?.isManager ?? false);

  const formSaving =
    createTeamMutation.isPending || updateTeamMutation.isPending;
  const addingMember = addMemberMutation.isPending;

  const columns: DataTableColumn<Team>[] = [
    {
      id: "team",
      header: "Team",
      sortValue: (team) => team.name,
      searchValue: (team) => `${team.name} ${team.description ?? ""}`,
      cell: (team) => (
        <div className="flex flex-col gap-1">
          <span className="text-sm font-semibold text-foreground">
            {team.name}
          </span>
          {team.description && (
            <span className="text-xs text-muted-foreground">
              {team.description}
            </span>
          )}
          {team.isManager && <ManagerPill />}
        </div>
      ),
    },
    {
      id: "members",
      header: "Members",
      headClassName: "text-right",
      cellClassName: "text-right",
      sortValue: (team) => team.memberCount,
      cell: (team) => (
        <>
          <span className="text-sm font-semibold tabular-nums text-foreground">
            {team.memberCount}
          </span>{" "}
          <span className="text-xs text-muted-foreground">
            member{team.memberCount === 1 ? "" : "s"}
          </span>
        </>
      ),
    },
    {
      id: "actions",
      header: "Actions",
      headClassName: "text-right",
      cellClassName: "text-right",
      cell: (team) => (
        <TeamActions
          team={team}
          canManageTeams={canManageTeams}
          onManage={openMembersDialog}
          onEdit={handleEditTeam}
          onDelete={setTeamToDelete}
        />
      ),
    },
  ];

  return (
    <>
      <Card>
        <CardHeader>
          <CardHeaderRow>
            <CardTitle>Team Management</CardTitle>
            {canManageTeams && (
              <Button onClick={handleCreateTeam} size="sm">
                <Plus className="h-4 w-4 mr-2" />
                Create Team
              </Button>
            )}
          </CardHeaderRow>
        </CardHeader>
        <CardContent>
          {canReadTeams ? (
            loading ? (
              <div className="flex justify-center py-8">
                <LoadingSpinner />
              </div>
            ) : (
              <DataTable
                data={teamList}
                columns={columns}
                getRowId={(team) => team.id}
                searchPlaceholder="Search teams..."
                defaultSort={{ columnId: "team", direction: "asc" }}
                getRowProps={() => ({
                  className: "hover:bg-surface-inset transition-colors",
                })}
                emptyState={
                  <p className="text-muted-foreground">No teams found.</p>
                }
                noResultsState={
                  <p className="text-muted-foreground">
                    No teams match your search.
                  </p>
                }
                renderMobileCard={(team) => (
                  <div className="group">
                    <div className="relative overflow-hidden rounded-[var(--d-card-r)] border border-border/70 bg-gradient-to-b from-surface-2 to-surface p-[var(--d-pad)] shadow-[0_1px_2px_hsl(var(--foreground)/0.04),0_10px_30px_-14px_hsl(var(--foreground)/0.12)] transition-all group-hover:-translate-y-0.5 group-hover:border-primary/40 group-hover:shadow-xl">
                      {team.isManager && (
                        <span
                          className="absolute inset-y-0 left-0 w-1 bg-status-ok"
                          aria-hidden
                        />
                      )}
                      <div className="flex items-start justify-between gap-3 pl-2">
                        <div className="min-w-0">
                          <div className="flex items-baseline gap-1.5">
                            <span className="text-3xl font-bold leading-none tabular-nums text-foreground">
                              {team.memberCount}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              member{team.memberCount === 1 ? "" : "s"}
                            </span>
                          </div>
                          <p className="mt-2 truncate text-sm font-semibold text-foreground">
                            {team.name}
                          </p>
                          {team.description && (
                            <p className="truncate text-xs text-muted-foreground">
                              {team.description}
                            </p>
                          )}
                        </div>
                        {team.isManager && <ManagerPill />}
                      </div>
                      <div className="mt-3 pl-2">
                        <TeamActions
                          team={team}
                          canManageTeams={canManageTeams}
                          onManage={openMembersDialog}
                          onEdit={handleEditTeam}
                          onDelete={setTeamToDelete}
                        />
                      </div>
                    </div>
                  </div>
                )}
              />
            )
          ) : (
            <p className="text-muted-foreground">
              You don't have access to view teams.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Create/Edit Team Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingTeam ? "Edit Team" : "Create Team"}
            </DialogTitle>
            <DialogDescription>
              {editingTeam
                ? "Update the team details below."
                : "Create a new team to organize resource access."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="Team name"
              />
            </div>
            <div>
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                placeholder="Optional description"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEditDialogOpen(false)}
              disabled={formSaving}
            >
              Cancel
            </Button>
            <Button onClick={handleSaveTeam} disabled={formSaving}>
              {formSaving ? "Saving..." : editingTeam ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Members Management Dialog */}
      <Dialog open={membersDialogOpen} onOpenChange={setMembersDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Manage {teamDetailData?.name ?? "team"}</DialogTitle>
            <DialogDescription>
              Members &amp; managers, and what this team is allowed to create.
            </DialogDescription>
          </DialogHeader>

          {membersLoading ? (
            <div className="flex justify-center py-8">
              <LoadingSpinner />
            </div>
          ) : teamDetailData ? (
            <div className="space-y-4">
              <p className="text-sm font-medium">Members</p>
              {/* Add Member: search the directory and click a result to add.
                  The field searches the whole user directory to ADD someone —
                  it is not a filter over the member list below — and a user
                  only exists in that directory once they have signed in at
                  least once (SSO/LDAP accounts materialise on first login), so
                  both facts are spelled out beneath it. */}
              {canManageThisTeam && (
                <div className="space-y-1">
                  <div className="flex gap-2">
                    <UserPickerCombobox
                      onSelect={(user) => handleAddMember(user.id)}
                      excludeUserIds={teamDetailData.members.map((m) => m.id)}
                      disabled={addingMember}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Adds a new member to this team. Only users who have signed in
                    at least once can be found; current members are hidden.
                  </p>
                </div>
              )}

              {/* Member List */}
              <div className="border rounded-lg divide-y max-h-64 overflow-y-auto">
                {teamDetailData.members.length === 0 ? (
                  <p className="text-muted-foreground text-center py-4">
                    No members yet
                  </p>
                ) : (
                  teamDetailData.members.map((member) => {
                    const isManager = teamDetailData.managers.some(
                      (m) => m.id === member.id,
                    );
                    return (
                      <div
                        key={member.id}
                        className="flex items-center justify-between p-3"
                      >
                        <div>
                          <div className="font-medium">{member.name}</div>
                          <div className="text-sm text-muted-foreground">
                            {member.email}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {isManager && (
                            <Badge variant="secondary">
                              <Crown className="h-3 w-3 mr-1" />
                              Manager
                            </Badge>
                          )}
                          {canManageThisTeam && (
                            <>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  handleToggleManager(member.id, isManager)
                                }
                                title={
                                  isManager
                                    ? "Remove manager role"
                                    : "Promote to manager"
                                }
                              >
                                <Crown
                                  className={`h-4 w-4 ${
                                    isManager ? "text-warning" : ""
                                  }`}
                                />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleRemoveMember(member.id)}
                                title="Remove from team"
                              >
                                <UserMinus className="h-4 w-4" />
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {selectedTeamId && (
                <TeamCreateGrantsEditor
                  teamId={selectedTeamId}
                  canManage={canManageTeams}
                />
              )}

              {selectedTeamId && (
                <TeamResourceGrantsEditor
                  teamId={selectedTeamId}
                  canManage={canManageTeams}
                />
              )}
            </div>
          ) : undefined}

          <DialogFooter>
            <Button onClick={() => setMembersDialogOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <ConfirmationModal
        isOpen={!!teamToDelete}
        onClose={() => setTeamToDelete(undefined)}
        onConfirm={handleDeleteTeam}
        isLoading={deleteTeamMutation.isPending}
        title="Delete Team"
        message="Are you sure you want to delete this team? All resource access grants associated with this team will be removed. This action cannot be undone."
        variant="danger"
      />
    </>
  );
};

/**
 * Multi-encoded "you manage this team" affordance: a status pill (ok tone +
 * dot + Crown glyph + label) that pairs with the card's left accent stripe so
 * the signal survives a grayscale render. Uses the colorblind-safe ok tone.
 */
const ManagerPill: React.FC = () => (
  <span className="inline-flex w-fit shrink-0 items-center gap-1.5 rounded-full bg-status-ok/10 px-2.5 py-1 text-xs font-medium text-status-ok">
    <span className="size-1.5 rounded-full bg-status-ok" aria-hidden />
    <Crown className="h-3 w-3" />
    Manager
  </span>
);

interface TeamActionsProps {
  team: Team;
  canManageTeams: boolean;
  onManage: (teamId: string) => void;
  onEdit: (team: Team) => void;
  onDelete: (teamId: string) => void;
}

/**
 * Shared per-team action buttons, rendered both in the desktop table cell
 * and the mobile card so action availability stays consistent.
 */
const TeamActions: React.FC<TeamActionsProps> = ({
  team,
  canManageTeams,
  onManage,
  onEdit,
  onDelete,
}) => (
  <RowActions>
    <RowAction
      icon={Users2}
      label={`Manage ${team.name} (members & creation rights)`}
      title="Manage team (members & creation rights)"
      onClick={() => onManage(team.id)}
    />
    <RowAction
      icon={Edit}
      label={`Edit ${team.name}`}
      onClick={() => onEdit(team)}
      disabled={!team.isManager && !canManageTeams}
      title={
        !team.isManager && !canManageTeams
          ? "You can only edit teams you manage"
          : "Edit team name & description"
      }
    />
    <RowAction
      icon={Trash2}
      label={`Delete ${team.name}`}
      tone="destructive"
      onClick={() => onDelete(team.id)}
      disabled={!canManageTeams}
      title={
        canManageTeams
          ? "Delete team"
          : "Only a platform admin can delete teams"
      }
    />
  </RowActions>
);
