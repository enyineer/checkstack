import React, { useEffect, useState } from "react";
import { useApi, permissionApiRef } from "@checkmate/frontend-api";
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
  LoadingSpinner,
  PageLayout,
  Checkbox,
  ConfirmationModal,
  Alert,
  DynamicForm,
  useToast,
} from "@checkmate/ui";
import { authApiRef, AuthUser, Role, AuthStrategy } from "../api";
import { permissions as authPermissions } from "@checkmate/auth-common";
import {
  Trash2,
  Shield,
  Settings2,
  Users,
  RefreshCw,
  ChevronDown,
  ChevronRight,
} from "lucide-react";

export const AuthSettingsPage: React.FC = () => {
  const authApi = useApi(authApiRef);
  const permissionApi = useApi(permissionApiRef);
  const toast = useToast();

  const session = authApi.useSession();

  const [activeTab, setActiveTab] = useState<"users" | "strategies">("users");
  const [users, setUsers] = useState<(AuthUser & { roles: string[] })[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [strategies, setStrategies] = useState<AuthStrategy[]>([]);
  const [loading, setLoading] = useState(true);
  const [reloading, setReloading] = useState(false);

  const [userToDelete, setUserToDelete] = useState<string>();
  const [expandedStrategy, setExpandedStrategy] = useState<string>();
  const [strategyConfigs, setStrategyConfigs] = useState<
    Record<string, Record<string, unknown>>
  >({});

  const canReadUsers = permissionApi.usePermission(
    authPermissions.usersRead.id
  );
  const canManageUsers = permissionApi.usePermission(
    authPermissions.usersManage.id
  );
  const canManageRoles = permissionApi.usePermission(
    authPermissions.rolesManage.id
  );
  const canManageStrategies = permissionApi.usePermission(
    authPermissions.strategiesManage.id
  );

  const fetchData = async () => {
    setLoading(true);
    try {
      const usersData = (await authApi.getUsers()) as (AuthUser & {
        roles: string[];
      })[];
      const rolesData = await authApi.getRoles();
      const strategiesData = await authApi.getStrategies();
      setUsers(usersData);
      setRoles(rolesData);
      setStrategies(strategiesData);

      // Initialize strategy configs
      const configs: Record<string, Record<string, unknown>> = {};
      for (const strategy of strategiesData) {
        configs[strategy.id] = strategy.config || {};
      }
      setStrategyConfigs(configs);
    } catch (error: unknown) {
      toast.error("Failed to fetch data");
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleDeleteUser = async () => {
    if (!userToDelete) return;
    try {
      await authApi.deleteUser(userToDelete);
      setUsers(users.filter((u) => u.id !== userToDelete));
      setUserToDelete(undefined);
    } catch {
      toast.error("Failed to delete user");
    }
  };

  const handleToggleRole = async (
    userId: string,
    roleId: string,
    currentRoles: string[]
  ) => {
    if (session.data?.user.id === userId) {
      toast.error("You cannot update your own roles");
      return;
    }

    const newRoles = currentRoles.includes(roleId)
      ? currentRoles.filter((r) => r !== roleId)
      : [...currentRoles, roleId];

    try {
      await authApi.updateUserRoles(userId, newRoles);
      setUsers(
        users.map((u) => (u.id === userId ? { ...u, roles: newRoles } : u))
      );
    } catch {
      toast.error("Failed to update roles");
    }
  };

  const handleToggleStrategy = async (strategyId: string, enabled: boolean) => {
    try {
      await authApi.toggleStrategy(strategyId, enabled);
      setStrategies(
        strategies.map((s) => (s.id === strategyId ? { ...s, enabled } : s))
      );
    } catch {
      toast.error("Failed to toggle strategy");
    }
  };

  const handleSaveStrategyConfig = async (strategyId: string) => {
    try {
      const config = strategyConfigs[strategyId];
      await authApi.updateStrategy(strategyId, { config });
      toast.success(
        "Configuration saved successfully! Click 'Reload Authentication' to apply changes."
      );
    } catch {
      toast.error("Failed to save strategy configuration");
    }
  };

  const handleReloadAuth = async () => {
    setReloading(true);
    try {
      await authApi.reloadAuth();
      toast.success("Authentication reloaded successfully!");
    } catch {
      toast.error("Failed to reload authentication");
    } finally {
      setReloading(false);
    }
  };

  if (loading) return <LoadingSpinner />;

  return (
    <PageLayout title="Authentication Settings">
      <div className="flex space-x-4 mb-6 border-b">
        <button
          onClick={() => setActiveTab("users")}
          className={`pb-2 px-4 flex items-center space-x-2 ${
            activeTab === "users"
              ? "border-b-2 border-primary text-primary"
              : "text-muted-foreground"
          }`}
        >
          <Users size={18} />
          <span>Users & Roles</span>
        </button>
        <button
          onClick={() => setActiveTab("strategies")}
          className={`pb-2 px-4 flex items-center space-x-2 ${
            activeTab === "strategies"
              ? "border-b-2 border-primary text-primary"
              : "text-muted-foreground"
          }`}
        >
          <Settings2 size={18} />
          <span>Authentication Strategies</span>
        </button>
      </div>

      {activeTab === "users" && (
        <Card>
          <CardHeader>
            <CardTitle>User Management</CardTitle>
          </CardHeader>
          <CardContent>
            {canReadUsers.allowed ? (
              users.length === 0 ? (
                <p className="text-muted-foreground">No users found.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>User</TableHead>
                      <TableHead>Roles</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {users.map((user) => (
                      <TableRow key={user.id}>
                        <TableCell>
                          <div className="flex flex-col">
                            <span className="font-medium">
                              {user.name || "N/A"}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {user.email}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-2">
                            {roles.map((role) => (
                              <div
                                key={role.id}
                                className="flex items-center space-x-2"
                              >
                                <Checkbox
                                  id={`role-${user.id}-${role.id}`}
                                  checked={user.roles.includes(role.id)}
                                  disabled={
                                    !canManageRoles.allowed ||
                                    session.data?.user.id === user.id
                                  }
                                  onCheckedChange={() =>
                                    handleToggleRole(
                                      user.id,
                                      role.id,
                                      user.roles
                                    )
                                  }
                                />
                                <label
                                  htmlFor={`role-${user.id}-${role.id}`}
                                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                                >
                                  {role.name}
                                </label>
                              </div>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          {canManageUsers.allowed &&
                            user.email !== "admin@checkmate.local" && (
                              <Button
                                variant="destructive"
                                size="icon"
                                onClick={() => setUserToDelete(user.id)}
                              >
                                <Trash2 size={16} />
                              </Button>
                            )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )
            ) : (
              <p className="text-muted-foreground">
                You don't have permission to list users.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {activeTab === "strategies" && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <Button
              onClick={handleReloadAuth}
              disabled={!canManageStrategies.allowed || reloading}
              className="gap-2"
            >
              <RefreshCw
                className={`h-4 w-4 ${reloading ? "animate-spin" : ""}`}
              />
              {reloading ? "Reloading..." : "Reload Authentication"}
            </Button>
          </div>

          {strategies.map((strategy) => (
            <Card key={strategy.id}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() =>
                          setExpandedStrategy(
                            expandedStrategy === strategy.id
                              ? undefined
                              : strategy.id
                          )
                        }
                        className="text-gray-500 hover:text-gray-700"
                      >
                        {expandedStrategy === strategy.id ? (
                          <ChevronDown className="h-5 w-5" />
                        ) : (
                          <ChevronRight className="h-5 w-5" />
                        )}
                      </button>
                      <div>
                        <CardTitle>{strategy.displayName}</CardTitle>
                        {strategy.description && (
                          <p className="text-sm text-muted-foreground mt-1">
                            {strategy.description}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id={`strategy-${strategy.id}`}
                      checked={strategy.enabled}
                      disabled={!canManageStrategies.allowed}
                      onCheckedChange={(checked) =>
                        handleToggleStrategy(strategy.id, !!checked)
                      }
                    />
                    <label
                      htmlFor={`strategy-${strategy.id}`}
                      className="text-sm font-medium"
                    >
                      {strategy.enabled ? "Enabled" : "Disabled"}
                    </label>
                  </div>
                </div>
              </CardHeader>

              {expandedStrategy === strategy.id && (
                <CardContent>
                  <div className="space-y-4">
                    <DynamicForm
                      schema={strategy.configSchema}
                      value={strategyConfigs[strategy.id] || {}}
                      onChange={(newConfig) => {
                        setStrategyConfigs({
                          ...strategyConfigs,
                          [strategy.id]: newConfig,
                        });
                      }}
                    />
                    <div className="flex justify-end gap-2">
                      <Button
                        onClick={() => handleSaveStrategyConfig(strategy.id)}
                        disabled={!canManageStrategies.allowed}
                      >
                        Save Configuration
                      </Button>
                    </div>
                  </div>
                </CardContent>
              )}
            </Card>
          ))}

          {!canManageStrategies.allowed && (
            <p className="text-xs text-muted-foreground mt-4">
              You don't have permission to manage strategies.
            </p>
          )}
          <Alert className="mt-6">
            <Shield className="h-4 w-4" />
            <p className="text-sm">
              Changes to authentication strategies require clicking the "Reload
              Authentication" button to take effect. This reloads the auth
              system without requiring a full restart.
            </p>
          </Alert>
        </div>
      )}

      <ConfirmationModal
        isOpen={!!userToDelete}
        onClose={() => setUserToDelete(undefined)}
        onConfirm={handleDeleteUser}
        title="Delete User"
        message="Are you sure you want to delete this user? This action cannot be undone."
      />
    </PageLayout>
  );
};
