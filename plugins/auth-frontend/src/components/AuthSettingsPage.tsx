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
  Badge,
  LoadingSpinner,
  PageLayout,
  Checkbox,
  ConfirmationModal,
  Alert,
  AlertIcon,
  AlertContent,
  AlertTitle,
  AlertDescription,
  DynamicForm,
  useToast,
  Tabs,
  TabPanel,
  PermissionDenied,
  Toggle,
} from "@checkmate/ui";
import { authApiRef, AuthUser, Role, AuthStrategy, Permission } from "../api";
import {
  permissions as authPermissions,
  AuthClient,
} from "@checkmate/auth-common";
import {
  Trash2,
  Shield,
  Settings2,
  Users,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Plus,
  Edit,
} from "lucide-react";
import { RoleDialog } from "./RoleDialog";
import { PermissionsViewDialog } from "./PermissionsViewDialog";
import { rpcApiRef } from "@checkmate/frontend-api";

export const AuthSettingsPage: React.FC = () => {
  const authApi = useApi(authApiRef);
  const rpcApi = useApi(rpcApiRef);
  const authClient = rpcApi.forPlugin<AuthClient>("auth-backend");
  const permissionApi = useApi(permissionApiRef);
  const toast = useToast();

  const session = authApi.useSession();

  const [activeTab, setActiveTab] = useState<"users" | "roles" | "strategies">(
    "users"
  );
  const [users, setUsers] = useState<(AuthUser & { roles: string[] })[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [strategies, setStrategies] = useState<AuthStrategy[]>([]);
  const [loading, setLoading] = useState(true);
  const [reloading, setReloading] = useState(false);

  const [userToDelete, setUserToDelete] = useState<string>();
  const [roleToDelete, setRoleToDelete] = useState<string>();
  const [roleDialogOpen, setRoleDialogOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<Role | undefined>();
  const [viewingRolePermissions, setViewingRolePermissions] = useState<
    Role | undefined
  >();
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
  const canReadRoles = permissionApi.usePermission(
    authPermissions.rolesRead.id
  );
  const canCreateRoles = permissionApi.usePermission(
    authPermissions.rolesCreate.id
  );
  const canUpdateRoles = permissionApi.usePermission(
    authPermissions.rolesUpdate.id
  );
  const canDeleteRoles = permissionApi.usePermission(
    authPermissions.rolesDelete.id
  );
  const canManageRoles = permissionApi.usePermission(
    authPermissions.rolesManage.id
  );
  const canManageStrategies = permissionApi.usePermission(
    authPermissions.strategiesManage.id
  );
  const canManageRegistration = permissionApi.usePermission(
    authPermissions.registrationManage.id
  );

  const [registrationSchema, setRegistrationSchema] = useState<
    Record<string, unknown> | undefined
  >();
  const [registrationSettings, setRegistrationSettings] = useState<
    Record<string, unknown>
  >({ allowRegistration: true });
  const [loadingRegistration, setLoadingRegistration] = useState(true);
  const [savingRegistration, setSavingRegistration] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      const usersData = (await authClient.getUsers()) as (AuthUser & {
        roles: string[];
      })[];
      const rolesData = await authClient.getRoles();
      const permissionsData = await authClient.getPermissions();
      const strategiesData = await authClient.getStrategies();
      setUsers(usersData);
      setRoles(rolesData);
      setPermissions(permissionsData);
      setStrategies(strategiesData);

      // Initialize strategy configs
      const configs: Record<string, Record<string, unknown>> = {};
      for (const strategy of strategiesData) {
        configs[strategy.id] = strategy.config || {};
      }
      setStrategyConfigs(configs);

      // Fetch registration schema and status
      if (canManageRegistration.allowed) {
        try {
          const [schema, status] = await Promise.all([
            authClient.getRegistrationSchema(),
            authClient.getRegistrationStatus(),
          ]);
          setRegistrationSchema(schema as Record<string, unknown>);
          setRegistrationSettings(status);
        } catch (error) {
          console.error("Failed to fetch registration data:", error);
        } finally {
          setLoadingRegistration(false);
        }
      }
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to fetch data";
      toast.error(message);
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
      await authClient.deleteUser(userToDelete);
      setUsers(users.filter((u) => u.id !== userToDelete));
      setUserToDelete(undefined);
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to delete user";
      toast.error(message);
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
      await authClient.updateUserRoles({ userId, roles: newRoles });
      setUsers(
        users.map((u) => (u.id === userId ? { ...u, roles: newRoles } : u))
      );
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to update roles";
      toast.error(message);
    }
  };

  const handleToggleStrategy = async (strategyId: string, enabled: boolean) => {
    try {
      await authClient.updateStrategy({ id: strategyId, enabled });
      setStrategies(
        strategies.map((s) => (s.id === strategyId ? { ...s, enabled } : s))
      );
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to toggle strategy";
      toast.error(message);
    }
  };

  const handleSaveStrategyConfig = async (strategyId: string) => {
    try {
      const config = strategyConfigs[strategyId];
      const strategy = strategies.find((s) => s.id === strategyId);
      if (!strategy) {
        toast.error("Strategy not found");
        return;
      }
      await authClient.updateStrategy({
        id: strategyId,
        enabled: strategy.enabled,
        config,
      });
      toast.success(
        "Configuration saved successfully! Click 'Reload Authentication' to apply changes."
      );
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to save strategy configuration";
      toast.error(message);
    }
  };

  const handleReloadAuth = async () => {
    setReloading(true);
    try {
      await authClient.reloadAuth();
      toast.success("Authentication reloaded successfully!");
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to reload authentication";
      toast.error(message);
    } finally {
      setReloading(false);
    }
  };

  const handleSaveRegistration = async () => {
    setSavingRegistration(true);
    try {
      await authClient.setRegistrationStatus(
        registrationSettings as { allowRegistration: boolean }
      );
      toast.success("Registration settings saved successfully");
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to update registration settings";
      toast.error(message);
    } finally {
      setSavingRegistration(false);
    }
  };

  const handleCreateRole = () => {
    setEditingRole(undefined);
    setRoleDialogOpen(true);
  };

  const handleEditRole = (role: Role) => {
    setEditingRole(role);
    setRoleDialogOpen(true);
  };

  const handleSaveRole = async (params: {
    id?: string;
    name: string;
    description?: string;
    permissions: string[];
  }) => {
    try {
      if (params.id) {
        // Update existing role - ID is required
        await authClient.updateRole({
          id: params.id,
          name: params.name,
          description: params.description,
          permissions: params.permissions,
        });
        toast.success("Role updated successfully");
      } else {
        // Create new role - No ID needed, backend generates it
        await authClient.createRole({
          name: params.name,
          description: params.description,
          permissions: params.permissions,
        });
        toast.success("Role created successfully");
      }
      await fetchData();
    } catch (error: unknown) {
      toast.error(
        error instanceof Error ? error.message : "Failed to save role"
      );
      throw error;
    }
  };

  const handleDeleteRole = async () => {
    if (!roleToDelete) return;
    try {
      await authClient.deleteRole(roleToDelete);
      toast.success("Role deleted successfully");
      setRoleToDelete(undefined);
      await fetchData();
    } catch (error: unknown) {
      toast.error(
        error instanceof Error ? error.message : "Failed to delete role"
      );
    }
  };

  if (loading) return <LoadingSpinner />;

  // Check if user is authenticated and has any permission to view this page
  if (!session.data?.user) {
    return (
      <PermissionDenied message="You must be logged in to access authentication settings." />
    );
  }

  // Check if user has permission to view at least one tab
  const hasAnyPermission =
    canReadUsers.allowed || canReadRoles.allowed || canManageStrategies.allowed;

  if (!hasAnyPermission) {
    return <PermissionDenied />;
  }

  const schemaHasProperties = (
    schema: Record<string, unknown> & { properties?: Record<string, unknown> }
  ) => {
    if (schema.properties) {
      return Object.keys(schema.properties).length > 0;
    }
    return false;
  };

  const configIsMissing = (strategy: AuthStrategy) => {
    return strategy.config === undefined;
  };

  return (
    <PageLayout title="Authentication Settings">
      <Tabs
        items={[
          {
            id: "users",
            label: "Users & Roles",
            icon: <Users size={18} />,
          },
          {
            id: "roles",
            label: "Roles & Permissions",
            icon: <Shield size={18} />,
          },
          {
            id: "strategies",
            label: "Authentication Strategies",
            icon: <Settings2 size={18} />,
          },
        ]}
        activeTab={activeTab}
        onTabChange={(tabId) =>
          setActiveTab(tabId as "users" | "roles" | "strategies")
        }
        className="mb-6"
      />

      <TabPanel id="users" activeTab={activeTab}>
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
      </TabPanel>

      <TabPanel id="roles" activeTab={activeTab}>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Role Management</CardTitle>
            {canCreateRoles.allowed && (
              <Button onClick={handleCreateRole} size="sm">
                <Plus className="h-4 w-4 mr-2" />
                Create Role
              </Button>
            )}
          </CardHeader>
          <CardContent>
            {canReadRoles.allowed ? (
              roles.length === 0 ? (
                <p className="text-muted-foreground">No roles found.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Role</TableHead>
                      <TableHead>Permissions</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {roles.map((role) => {
                      const userData = users.find(
                        (u) => u.id === session.data?.user?.id
                      );
                      const userRoles = userData?.roles || [];
                      const isUserRole = userRoles.includes(role.id);
                      const isSystem = role.isSystem;

                      return (
                        <TableRow key={role.id}>
                          <TableCell>
                            <div className="flex flex-col">
                              <span className="font-medium">{role.name}</span>
                              {role.description && (
                                <span className="text-sm text-muted-foreground">
                                  {role.description}
                                </span>
                              )}
                              <div className="flex gap-2 mt-1">
                                {isSystem && (
                                  <Badge variant="outline">System</Badge>
                                )}
                                {isUserRole && (
                                  <Badge variant="secondary">Your Role</Badge>
                                )}
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <button
                              onClick={() => setViewingRolePermissions(role)}
                              className="text-sm text-primary hover:underline cursor-pointer"
                            >
                              {role.permissions?.length || 0} permissions
                            </button>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-2">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleEditRole(role)}
                                disabled={
                                  isSystem ||
                                  isUserRole ||
                                  !canUpdateRoles.allowed
                                }
                              >
                                <Edit className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setRoleToDelete(role.id)}
                                disabled={
                                  isSystem ||
                                  isUserRole ||
                                  !canDeleteRoles.allowed
                                }
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )
            ) : (
              <p className="text-muted-foreground">
                You don't have permission to view roles.
              </p>
            )}
          </CardContent>
        </Card>
      </TabPanel>

      <TabPanel id="strategies" activeTab={activeTab}>
        <div className="space-y-4">
          {/* Platform Settings */}
          <Card>
            <CardHeader>
              <CardTitle>Platform Settings</CardTitle>
            </CardHeader>
            <CardContent>
              {canManageRegistration.allowed ? (
                loadingRegistration ? (
                  <div className="flex justify-center py-4">
                    <LoadingSpinner />
                  </div>
                ) : registrationSchema ? (
                  <div className="space-y-4">
                    <DynamicForm
                      schema={registrationSchema}
                      value={registrationSettings}
                      onChange={setRegistrationSettings}
                    />
                    <Button
                      onClick={() => void handleSaveRegistration()}
                      disabled={savingRegistration}
                    >
                      {savingRegistration ? "Saving..." : "Save Settings"}
                    </Button>
                  </div>
                ) : (
                  <p className="text-muted-foreground">
                    Failed to load registration settings
                  </p>
                )
              ) : (
                <p className="text-sm text-muted-foreground">
                  You don't have permission to manage registration settings.
                </p>
              )}
            </CardContent>
          </Card>

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

          {(() => {
            const enabledStrategies = strategies.filter((s) => s.enabled);
            const hasNoEnabled = enabledStrategies.length === 0;

            return (
              <>
                {hasNoEnabled && (
                  <Alert variant="warning">
                    <AlertIcon>
                      <Shield className="h-4 w-4" />
                    </AlertIcon>
                    <AlertContent>
                      <AlertTitle>
                        No authentication strategies enabled
                      </AlertTitle>
                      <AlertDescription>
                        You won't be able to log in! Please enable at least one
                        authentication strategy and reload authentication.
                      </AlertDescription>
                    </AlertContent>
                  </Alert>
                )}
              </>
            );
          })()}

          <Alert className="mt-6">
            <AlertIcon>
              <Shield className="h-4 w-4" />
            </AlertIcon>
            <AlertContent>
              <AlertDescription>
                Changes to authentication strategies require clicking the
                "Reload Authentication" button to take effect. This reloads the
                auth system without requiring a full restart.
              </AlertDescription>
            </AlertContent>
          </Alert>

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
                        className="text-muted-foreground hover:text-foreground"
                      >
                        {expandedStrategy === strategy.id ? (
                          <ChevronDown className="h-5 w-5" />
                        ) : (
                          <ChevronRight className="h-5 w-5" />
                        )}
                      </button>
                      <div>
                        <div className="flex items-center gap-2">
                          <CardTitle>{strategy.displayName}</CardTitle>
                          {schemaHasProperties(strategy.configSchema) &&
                            configIsMissing(strategy) && (
                              <Badge variant="warning">
                                Needs Configuration
                              </Badge>
                            )}
                        </div>
                        {strategy.description && (
                          <p className="text-sm text-muted-foreground mt-1">
                            {strategy.description}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Toggle
                      checked={strategy.enabled}
                      disabled={
                        !canManageStrategies.allowed ||
                        // Disable if strategy needs config (has schema properties) but doesn't have any saved
                        (schemaHasProperties(strategy.configSchema) &&
                          configIsMissing(strategy))
                      }
                      onCheckedChange={(checked) =>
                        handleToggleStrategy(strategy.id, checked)
                      }
                    />
                  </div>
                </div>
              </CardHeader>

              {expandedStrategy === strategy.id && (
                <CardContent>
                  <div className="space-y-4">
                    <DynamicForm
                      schema={{
                        ...strategy.configSchema,
                        properties: Object.fromEntries(
                          Object.entries(
                            strategy.configSchema.properties || {}
                          ).filter(([key]) => key !== "enabled")
                        ),
                      }}
                      value={strategyConfigs[strategy.id] || {}}
                      onChange={(newConfig) => {
                        setStrategyConfigs({
                          ...strategyConfigs,
                          [strategy.id]: newConfig,
                        });
                      }}
                    />
                    {schemaHasProperties(strategy.configSchema) && (
                      <div className="flex justify-end gap-2">
                        <Button
                          onClick={() => handleSaveStrategyConfig(strategy.id)}
                          disabled={!canManageStrategies.allowed}
                        >
                          Save Configuration
                        </Button>
                      </div>
                    )}
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
        </div>
      </TabPanel>

      <ConfirmationModal
        isOpen={!!userToDelete}
        onClose={() => setUserToDelete(undefined)}
        onConfirm={handleDeleteUser}
        title="Delete User"
        message="Are you sure you want to delete this user? This action cannot be undone."
      />

      <PermissionsViewDialog
        open={!!viewingRolePermissions}
        onOpenChange={(open) => !open && setViewingRolePermissions(undefined)}
        role={viewingRolePermissions}
        permissions={permissions}
      />

      <RoleDialog
        open={roleDialogOpen}
        onOpenChange={setRoleDialogOpen}
        role={editingRole}
        permissions={permissions}
        onSave={handleSaveRole}
      />

      <ConfirmationModal
        isOpen={!!roleToDelete}
        onClose={() => setRoleToDelete(undefined)}
        onConfirm={handleDeleteRole}
        title="Delete Role"
        message="Are you sure you want to delete this role? This action cannot be undone."
      />
    </PageLayout>
  );
};
