import React, { useState, useEffect } from "react";
import {
  Card,
  CardHeader,
  CardHeaderRow,
  CardTitle,
  CardContent,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Button,
  Badge,
  ConfirmationModal,
  useToast,
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
import { extractErrorMessage } from "@checkstack/common";
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
      toast.error(
        extractErrorMessage(error, "Failed to create team"),
      );
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
      toast.error(
        extractErrorMessage(error, "Failed to update team"),
      );
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
      toast.error(
        extractErrorMessage(error, "Failed to delete team"),
      );
    },
  });

  const addMemberMutation = authClient.addUserToTeam.useMutation({
    onSuccess: () => {
      toast.success("Member added successfully");
      void refetchTeamDetail();
      void refetchTeams();
    },
    onError: (error) => {
      toast.error(
        extractErrorMessage(error, "Failed to add member"),
      );
    },
  });

  const removeMemberMutation = authClient.removeUserFromTeam.useMutation({
    onSuccess: () => {
      toast.success("Member removed");
      void refetchTeamDetail();
      void refetchTeams();
    },
    onError: (error) => {
      toast.error(
        extractErrorMessage(error, "Failed to remove member"),
      );
    },
  });

  const addManagerMutation = authClient.addTeamManager.useMutation({
    onSuccess: () => {
      toast.success("Member promoted to manager");
      void refetchTeamDetail();
    },
    onError: (error) => {
      toast.error(
        extractErrorMessage(error, "Failed to promote to manager"),
      );
    },
  });

  const removeManagerMutation = authClient.removeTeamManager.useMutation({
    onSuccess: () => {
      toast.success("Manager role removed");
      void refetchTeamDetail();
    },
    onError: (error) => {
      toast.error(
        extractErrorMessage(error, "Failed to remove manager role"),
      );
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
  const canManageThisTeam =
    canManageTeams ||
    (teams.find((t) => t.id === selectedTeamId)?.isManager ?? false);

  const formSaving =
    createTeamMutation.isPending || updateTeamMutation.isPending;
  const addingMember = addMemberMutation.isPending;

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
            ) : (teams as Team[]).length === 0 ? (
              <p className="text-muted-foreground">No teams found.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Team</TableHead>
                    <TableHead>Members</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(teams as Team[]).map((team) => (
                    <TableRow key={team.id}>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-medium">{team.name}</span>
                          {team.description && (
                            <span className="text-sm text-muted-foreground">
                              {team.description}
                            </span>
                          )}
                          {team.isManager && (
                            <Badge variant="secondary" className="mt-1 w-fit">
                              <Crown className="h-3 w-3 mr-1" />
                              Manager
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="text-muted-foreground">
                          {team.memberCount} member
                          {team.memberCount === 1 ? "" : "s"}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openMembersDialog(team.id)}
                            title="Manage team (members & creation rights)"
                            aria-label={`Manage ${team.name} (members & creation rights)`}
                          >
                            <Users2 className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleEditTeam(team)}
                            disabled={!team.isManager && !canManageTeams}
                            title={
                              !team.isManager && !canManageTeams
                                ? "You can only edit teams you manage"
                                : "Edit team name & description"
                            }
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setTeamToDelete(team.id)}
                            disabled={!canManageTeams}
                            title={
                              canManageTeams
                                ? "Delete team"
                                : "Only a platform admin can delete teams"
                            }
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
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
              {/* Add Member: search the directory and click a result to add. */}
              {canManageThisTeam && (
                <div className="flex gap-2">
                  <UserPickerCombobox
                    onSelect={(user) => handleAddMember(user.id)}
                    excludeUserIds={teamDetailData.members.map((m) => m.id)}
                    disabled={addingMember}
                  />
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
