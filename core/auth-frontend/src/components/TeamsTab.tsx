import React, { useState, useEffect, useCallback } from "react";
import {
  Card,
  CardHeader,
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@checkstack/ui";
import {
  Plus,
  Edit,
  Trash2,
  Users2,
  Crown,
  UserPlus,
  UserMinus,
} from "lucide-react";
import { useApi } from "@checkstack/frontend-api";
import { rpcApiRef } from "@checkstack/frontend-api";
import { AuthApi } from "@checkstack/auth-common";
import type { AuthUser } from "../api";

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
  users: AuthUser[];
  canReadTeams: boolean;
  canManageTeams: boolean;
  onDataChange: () => Promise<void>;
}

export const TeamsTab: React.FC<TeamsTabProps> = ({
  users,
  canReadTeams,
  canManageTeams,
  onDataChange,
}) => {
  const rpcApi = useApi(rpcApiRef);
  const authClient = rpcApi.forPlugin(AuthApi);
  const toast = useToast();

  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [teamToDelete, setTeamToDelete] = useState<string>();
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingTeam, setEditingTeam] = useState<Team | undefined>();
  const [membersDialogOpen, setMembersDialogOpen] = useState(false);
  const [selectedTeamDetail, setSelectedTeamDetail] = useState<TeamDetail>();
  const [membersLoading, setMembersLoading] = useState(false);

  // Team form state
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formSaving, setFormSaving] = useState(false);

  // Member management state
  const [selectedUserId, setSelectedUserId] = useState("");
  const [addingMember, setAddingMember] = useState(false);

  const loadTeams = useCallback(async () => {
    setLoading(true);
    try {
      const teamsData = await authClient.getTeams();
      setTeams(teamsData);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to load teams"
      );
    } finally {
      setLoading(false);
    }
  }, [authClient, toast]);

  useEffect(() => {
    loadTeams();
  }, [loadTeams]);

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

  const handleSaveTeam = async () => {
    if (!formName.trim()) {
      toast.error("Team name is required");
      return;
    }

    setFormSaving(true);
    try {
      if (editingTeam) {
        await authClient.updateTeam({
          id: editingTeam.id,
          name: formName,
          description: formDescription || undefined,
        });
        toast.success("Team updated successfully");
      } else {
        await authClient.createTeam({
          name: formName,
          description: formDescription || undefined,
        });
        toast.success("Team created successfully");
      }
      setEditDialogOpen(false);
      await loadTeams();
      await onDataChange();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to save team"
      );
    } finally {
      setFormSaving(false);
    }
  };

  const handleDeleteTeam = async () => {
    if (!teamToDelete) return;
    try {
      await authClient.deleteTeam(teamToDelete);
      toast.success("Team deleted successfully");
      setTeamToDelete(undefined);
      await loadTeams();
      await onDataChange();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to delete team"
      );
    }
  };

  const openMembersDialog = async (teamId: string) => {
    setMembersLoading(true);
    setMembersDialogOpen(true);
    try {
      const detail = await authClient.getTeam({ teamId });
      setSelectedTeamDetail(detail ?? undefined);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to load team details"
      );
      setMembersDialogOpen(false);
    } finally {
      setMembersLoading(false);
    }
  };

  const handleAddMember = async () => {
    if (!selectedTeamDetail || !selectedUserId) return;

    setAddingMember(true);
    try {
      await authClient.addUserToTeam({
        teamId: selectedTeamDetail.id,
        userId: selectedUserId,
      });
      toast.success("Member added successfully");
      // Reload team details
      const detail = await authClient.getTeam({
        teamId: selectedTeamDetail.id,
      });
      setSelectedTeamDetail(detail ?? undefined);
      setSelectedUserId("");
      await loadTeams();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to add member"
      );
    } finally {
      setAddingMember(false);
    }
  };

  const handleRemoveMember = async (userId: string) => {
    if (!selectedTeamDetail) return;

    try {
      await authClient.removeUserFromTeam({
        teamId: selectedTeamDetail.id,
        userId,
      });
      toast.success("Member removed");
      // Reload team details
      const detail = await authClient.getTeam({
        teamId: selectedTeamDetail.id,
      });
      setSelectedTeamDetail(detail ?? undefined);
      await loadTeams();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to remove member"
      );
    }
  };

  const handleToggleManager = async (
    userId: string,
    isCurrentlyManager: boolean
  ) => {
    if (!selectedTeamDetail) return;

    try {
      if (isCurrentlyManager) {
        await authClient.removeTeamManager({
          teamId: selectedTeamDetail.id,
          userId,
        });
        toast.success("Manager role removed");
      } else {
        await authClient.addTeamManager({
          teamId: selectedTeamDetail.id,
          userId,
        });
        toast.success("Member promoted to manager");
      }
      // Reload team details
      const detail = await authClient.getTeam({
        teamId: selectedTeamDetail.id,
      });
      setSelectedTeamDetail(detail ?? undefined);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to update manager status"
      );
    }
  };

  // Get users not already in the team
  const availableUsers = selectedTeamDetail
    ? users.filter(
        (u) => !selectedTeamDetail.members.some((m) => m.id === u.id)
      )
    : [];

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Team Management</CardTitle>
          {canManageTeams && (
            <Button onClick={handleCreateTeam} size="sm">
              <Plus className="h-4 w-4 mr-2" />
              Create Team
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {canReadTeams ? (
            loading ? (
              <div className="flex justify-center py-8">
                <LoadingSpinner />
              </div>
            ) : teams.length === 0 ? (
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
                  {teams.map((team) => (
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
                            title="Manage members"
                          >
                            <Users2 className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleEditTeam(team)}
                            disabled={!team.isManager && !canManageTeams}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setTeamToDelete(team.id)}
                            disabled={!canManageTeams}
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
            <DialogTitle>
              {selectedTeamDetail?.name ?? "Team"} Members
            </DialogTitle>
            <DialogDescription>
              Manage team membership and assign managers.
            </DialogDescription>
          </DialogHeader>

          {membersLoading ? (
            <div className="flex justify-center py-8">
              <LoadingSpinner />
            </div>
          ) : selectedTeamDetail ? (
            <div className="space-y-4">
              {/* Add Member Form */}
              {(selectedTeamDetail.managers.some((m) =>
                users.some((u) => u.id === m.id)
              ) ||
                canManageTeams) && (
                <div className="flex gap-2">
                  <Select
                    value={selectedUserId}
                    onValueChange={setSelectedUserId}
                  >
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder="Select user to add" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableUsers.length === 0 ? (
                        <SelectItem value="_none" disabled>
                          No available users
                        </SelectItem>
                      ) : (
                        availableUsers.map((user) => (
                          <SelectItem key={user.id} value={user.id}>
                            {user.name} ({user.email})
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                  <Button
                    onClick={handleAddMember}
                    disabled={!selectedUserId || addingMember}
                    size="sm"
                  >
                    <UserPlus className="h-4 w-4 mr-1" />
                    Add
                  </Button>
                </div>
              )}

              {/* Member List */}
              <div className="border rounded-lg divide-y max-h-64 overflow-y-auto">
                {selectedTeamDetail.members.length === 0 ? (
                  <p className="text-muted-foreground text-center py-4">
                    No members yet
                  </p>
                ) : (
                  selectedTeamDetail.members.map((member) => {
                    const isManager = selectedTeamDetail.managers.some(
                      (m) => m.id === member.id
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
                          {canManageTeams && (
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
        title="Delete Team"
        message="Are you sure you want to delete this team? All resource access grants associated with this team will be removed. This action cannot be undone."
        variant="danger"
      />
    </>
  );
};
