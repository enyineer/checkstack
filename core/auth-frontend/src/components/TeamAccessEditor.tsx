import React, { useState, useEffect, useCallback } from "react";
import {
  Card,
  CardHeader,
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
  Label,
} from "@checkstack/ui";
import {
  Plus,
  Trash2,
  Users2,
  Shield,
  Eye,
  Settings,
  Lock,
} from "lucide-react";
import { useApi, rpcApiRef, permissionApiRef } from "@checkstack/frontend-api";
import {
  AuthApi,
  permissions as authPermissions,
} from "@checkstack/auth-common";

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
 * Used in System editor, Health Check editor, Incident/Maintenance forms.
 */
export const TeamAccessEditor: React.FC<TeamAccessEditorProps> = ({
  resourceType,
  resourceId,
  expanded: initialExpanded = false,
  compact = false,
  onChange,
}) => {
  const rpcApi = useApi(rpcApiRef);
  const permissionApi = useApi(permissionApiRef);
  const authClient = rpcApi.forPlugin(AuthApi);
  const toast = useToast();

  const { allowed: canManageTeams } = permissionApi.usePermission(
    authPermissions.teamsManage.id
  );

  const [expanded, setExpanded] = useState(initialExpanded);
  const [loading, setLoading] = useState(false);
  const [accessList, setAccessList] = useState<TeamAccess[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState("");
  const [adding, setAdding] = useState(false);
  const [teamOnly, setTeamOnly] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [accessData, teamsData, settingsData] = await Promise.all([
        authClient.getResourceTeamAccess({ resourceType, resourceId }),
        authClient.getTeams(),
        authClient.getResourceAccessSettings({ resourceType, resourceId }),
      ]);
      setAccessList(accessData);
      setTeams(teamsData);
      setTeamOnly(settingsData.teamOnly);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to load team access"
      );
    } finally {
      setLoading(false);
    }
  }, [authClient, resourceType, resourceId, toast]);

  useEffect(() => {
    if (expanded && resourceId) {
      loadData();
    }
  }, [expanded, resourceId, loadData]);

  const handleAddTeam = async () => {
    if (!selectedTeamId) return;

    setAdding(true);
    try {
      await authClient.setResourceTeamAccess({
        resourceType,
        resourceId,
        teamId: selectedTeamId,
        canRead: true,
        canManage: false,
      });
      toast.success("Team access granted");
      setSelectedTeamId("");
      await loadData();
      onChange?.();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to add team access"
      );
    } finally {
      setAdding(false);
    }
  };

  const handleUpdateAccess = async (
    teamId: string,
    updates: { canRead?: boolean; canManage?: boolean }
  ) => {
    try {
      await authClient.setResourceTeamAccess({
        resourceType,
        resourceId,
        teamId,
        ...updates,
      });
      await loadData();
      onChange?.();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to update access"
      );
    }
  };

  const handleUpdateSettings = async (newTeamOnly: boolean) => {
    try {
      await authClient.setResourceAccessSettings({
        resourceType,
        resourceId,
        teamOnly: newTeamOnly,
      });
      setTeamOnly(newTeamOnly);
      onChange?.();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to update settings"
      );
    }
  };

  const handleRemoveAccess = async (teamId: string) => {
    try {
      await authClient.removeResourceTeamAccess({
        resourceType,
        resourceId,
        teamId,
      });

      // Check if this was the last team - if so, clear settings too
      const remainingTeams = accessList.filter((a) => a.teamId !== teamId);
      if (remainingTeams.length === 0 && teamOnly) {
        // Reset teamOnly when no teams have access
        await authClient.setResourceAccessSettings({
          resourceType,
          resourceId,
          teamOnly: false,
        });
        setTeamOnly(false);
      }

      toast.success("Team access removed");
      await loadData();
      onChange?.();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to remove access"
      );
    }
  };

  // Get teams that don't already have access
  const availableTeams = teams.filter(
    (t) => !accessList.some((a) => a.teamId === t.id)
  );

  // Compact summary mode
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
          <span>Team Access</span>
          {accessList.length > 0 && (
            <Badge variant="secondary" className="ml-1">
              {accessList.length}
            </Badge>
          )}
        </Button>
      </div>
    );
  }

  // Full editor mode
  if (compact) {
    return (
      <div className="border rounded-lg p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium text-sm">Team Access Control</span>
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

        {loading ? (
          <div className="flex justify-center py-4">
            <LoadingSpinner />
          </div>
        ) : (
          <>
            {/* Resource-level Team Only setting */}
            {accessList.length > 0 && (
              <div className="flex items-center justify-between p-2 bg-muted/30 rounded-md">
                <div className="flex items-center gap-2">
                  <Lock className="h-4 w-4 text-muted-foreground" />
                  <Label
                    htmlFor="team-only-compact"
                    className="text-sm cursor-pointer"
                  >
                    Team Only
                  </Label>
                  <span className="text-xs text-muted-foreground">
                    (Bypass global permissions)
                  </span>
                </div>
                <Toggle
                  checked={teamOnly}
                  onCheckedChange={handleUpdateSettings}
                  disabled={!canManageTeams}
                />
              </div>
            )}

            {/* Add team row */}
            {canManageTeams && (
              <div className="flex gap-2">
                <Select
                  value={selectedTeamId}
                  onValueChange={setSelectedTeamId}
                >
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="Select team to add" />
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
            )}

            {/* Access list */}
            <div className="space-y-2">
              {accessList.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-2">
                  No team restrictions. All users with permission can access.
                </p>
              ) : (
                accessList.map((access) => (
                  <div
                    key={access.teamId}
                    className="flex items-center justify-between p-2 bg-muted/50 rounded-md"
                  >
                    <div className="flex items-center gap-2">
                      <Users2 className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium text-sm">
                        {access.teamName}
                      </span>
                      <div className="flex gap-1">
                        {canManageTeams ? (
                          <>
                            <Badge
                              variant={access.canRead ? "default" : "secondary"}
                              className="text-xs cursor-pointer hover:opacity-80"
                              onClick={() =>
                                handleUpdateAccess(access.teamId, {
                                  canRead: !access.canRead,
                                })
                              }
                            >
                              <Eye className="h-3 w-3 mr-1" />
                              Read
                            </Badge>
                            <Badge
                              variant={
                                access.canManage ? "default" : "secondary"
                              }
                              className="text-xs cursor-pointer hover:opacity-80"
                              onClick={() =>
                                handleUpdateAccess(access.teamId, {
                                  canManage: !access.canManage,
                                })
                              }
                            >
                              <Settings className="h-3 w-3 mr-1" />
                              Manage
                            </Badge>
                          </>
                        ) : (
                          <>
                            {access.canRead && (
                              <Badge variant="outline" className="text-xs">
                                <Eye className="h-3 w-3 mr-1" />
                                Read
                              </Badge>
                            )}
                            {access.canManage && (
                              <Badge variant="secondary" className="text-xs">
                                <Settings className="h-3 w-3 mr-1" />
                                Manage
                              </Badge>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                    {canManageTeams && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRemoveAccess(access.teamId)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </div>
    );
  }

  // Card mode (default)
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between py-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Shield className="h-4 w-4" />
          Team Access Control
        </CardTitle>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setExpanded(false)}
        >
          Collapse
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex justify-center py-4">
            <LoadingSpinner />
          </div>
        ) : (
          <>
            {/* Add team row */}
            {canManageTeams && (
              <div className="flex gap-2">
                <Select
                  value={selectedTeamId}
                  onValueChange={setSelectedTeamId}
                >
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="Select team to add" />
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
                  <Plus className="h-4 w-4 mr-1" />
                  Add
                </Button>
              </div>
            )}

            {/* Resource-level Team Only setting */}
            {accessList.length > 0 && (
              <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
                <div className="flex items-center gap-2">
                  <Lock className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <Label htmlFor="team-only-card" className="cursor-pointer">
                      Team Only Mode
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      When enabled, only team members can access (global
                      permissions bypassed)
                    </p>
                  </div>
                </div>
                <Toggle
                  checked={teamOnly}
                  onCheckedChange={handleUpdateSettings}
                  disabled={!canManageTeams}
                />
              </div>
            )}

            {/* Access list */}
            {accessList.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4 bg-muted/30 rounded-lg">
                No team restrictions configured. All users with appropriate
                permissions can access this resource.
              </p>
            ) : (
              <div className="border rounded-lg divide-y">
                {accessList.map((access) => (
                  <div
                    key={access.teamId}
                    className="p-3 flex items-center justify-between"
                  >
                    <div className="flex items-center gap-3">
                      <Users2 className="h-5 w-5 text-muted-foreground" />
                      <div>
                        <div className="font-medium">{access.teamName}</div>
                        <div className="flex gap-3 mt-1">
                          <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
                            <Checkbox
                              checked={access.canRead}
                              onCheckedChange={(checked) =>
                                handleUpdateAccess(access.teamId, {
                                  canRead: !!checked,
                                })
                              }
                              disabled={!canManageTeams}
                            />
                            <Eye className="h-3 w-3" />
                            Read
                          </label>
                          <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
                            <Checkbox
                              checked={access.canManage}
                              onCheckedChange={(checked) =>
                                handleUpdateAccess(access.teamId, {
                                  canManage: !!checked,
                                })
                              }
                              disabled={!canManageTeams}
                            />
                            <Settings className="h-3 w-3" />
                            Manage
                          </label>
                        </div>
                      </div>
                    </div>
                    {canManageTeams && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRemoveAccess(access.teamId)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              <strong>Read:</strong> View this resource •{" "}
              <strong>Manage:</strong> Edit this resource
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default TeamAccessEditor;
