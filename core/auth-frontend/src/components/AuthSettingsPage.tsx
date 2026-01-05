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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@checkmate/ui";
import { authApiRef, AuthUser, Role, AuthStrategy, Permission } from "../api";
import {
  permissions as authPermissions,
  AuthApi,
} from "@checkmate/auth-common";
import {
  Trash2,
  Shield,
  Settings2,
  Users,
  RefreshCw,
  Plus,
  Edit,
  Key,
  Copy,
  RotateCcw,
} from "lucide-react";
import { RoleDialog } from "./RoleDialog";
import { AuthStrategyCard } from "./AuthStrategyCard";
import { CreateUserDialog } from "./CreateUserDialog";
import { rpcApiRef } from "@checkmate/frontend-api";

export const AuthSettingsPage: React.FC = () => {
  const authApi = useApi(authApiRef);
  const rpcApi = useApi(rpcApiRef);
  const authClient = rpcApi.forPlugin(AuthApi);
  const permissionApi = useApi(permissionApiRef);
  const toast = useToast();

  const session = authApi.useSession();

  const [activeTab, setActiveTab] = useState<
    "users" | "roles" | "strategies" | "applications"
  >("users");
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
  const [expandedStrategy, setExpandedStrategy] = useState<string>();
  const [createUserDialogOpen, setCreateUserDialogOpen] = useState(false);
  const [strategyConfigs, setStrategyConfigs] = useState<
    Record<string, Record<string, unknown>>
  >({});

  const canReadUsers = permissionApi.usePermission(
    authPermissions.usersRead.id
  );
  const canManageUsers = permissionApi.usePermission(
    authPermissions.usersManage.id
  );
  const canCreateUsers = permissionApi.usePermission(
    authPermissions.usersCreate.id
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
  const canManageApplications = permissionApi.usePermission(
    authPermissions.applicationsManage.id
  );

  const [registrationSchema, setRegistrationSchema] = useState<
    Record<string, unknown> | undefined
  >();
  const [registrationSettings, setRegistrationSettings] = useState<
    Record<string, unknown>
  >({ allowRegistration: true });
  const [loadingRegistration, setLoadingRegistration] = useState(true);
  const [savingRegistration, setSavingRegistration] = useState(false);

  // Applications state
  type Application = {
    id: string;
    name: string;
    description?: string | null;
    roles: string[];
    createdById: string;
    createdAt: Date;
    lastUsedAt?: Date | null;
  };
  const [applications, setApplications] = useState<Application[]>([]);
  const [loadingApplications, setLoadingApplications] = useState(true);
  const [applicationToDelete, setApplicationToDelete] = useState<string>();
  const [newSecretDialog, setNewSecretDialog] = useState<{
    open: boolean;
    secret: string;
    applicationName: string;
  }>({ open: false, secret: "", applicationName: "" });
  const [createAppDialogOpen, setCreateAppDialogOpen] = useState(false);
  const [newAppName, setNewAppName] = useState("");
  const [newAppDescription, setNewAppDescription] = useState("");

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
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to fetch data";
      toast.error(message);
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  // Fetch registration data separately when permission becomes available
  const fetchRegistrationData = async () => {
    setLoadingRegistration(true);
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
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Fetch registration data when permission becomes available
  useEffect(() => {
    if (canManageRegistration.allowed && !canManageRegistration.loading) {
      fetchRegistrationData();
    } else if (!canManageRegistration.loading) {
      // No permission, stop loading state
      setLoadingRegistration(false);
    }
  }, [canManageRegistration.allowed, canManageRegistration.loading]);

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

  const handleCreateUser = async (data: {
    name: string;
    email: string;
    password: string;
  }) => {
    try {
      await authClient.createCredentialUser(data);
      toast.success("User created successfully");
      await fetchData();
    } catch (error: unknown) {
      toast.error(
        error instanceof Error ? error.message : "Failed to create user"
      );
      throw error;
    }
  };

  // ==========================================================================
  // APPLICATION HANDLERS
  // ==========================================================================

  const fetchApplications = async () => {
    setLoadingApplications(true);
    try {
      const apps = await authClient.getApplications();
      setApplications(apps);
    } catch (error) {
      console.error("Failed to fetch applications:", error);
    } finally {
      setLoadingApplications(false);
    }
  };

  // Fetch applications when permission becomes available
  useEffect(() => {
    if (canManageApplications.allowed && !canManageApplications.loading) {
      fetchApplications();
    } else if (!canManageApplications.loading) {
      setLoadingApplications(false);
    }
  }, [canManageApplications.allowed, canManageApplications.loading]);

  const handleCreateApplication = async () => {
    if (!newAppName.trim()) {
      toast.error("Application name is required");
      return;
    }
    try {
      const result = await authClient.createApplication({
        name: newAppName.trim(),
        description: newAppDescription.trim() || undefined,
      });
      setApplications([...applications, result.application]);
      setCreateAppDialogOpen(false);
      setNewAppName("");
      setNewAppDescription("");
      // Show the secret
      setNewSecretDialog({
        open: true,
        secret: result.secret,
        applicationName: result.application.name,
      });
      toast.success("Application created successfully");
    } catch (error: unknown) {
      toast.error(
        error instanceof Error ? error.message : "Failed to create application"
      );
    }
  };

  const handleToggleApplicationRole = async (
    appId: string,
    roleId: string,
    currentRoles: string[]
  ) => {
    const newRoles = currentRoles.includes(roleId)
      ? currentRoles.filter((r) => r !== roleId)
      : [...currentRoles, roleId];
    try {
      await authClient.updateApplication({ id: appId, roles: newRoles });
      setApplications(
        applications.map((app) =>
          app.id === appId ? { ...app, roles: newRoles } : app
        )
      );
      toast.success("Application roles updated");
    } catch (error: unknown) {
      toast.error(
        error instanceof Error ? error.message : "Failed to update roles"
      );
    }
  };

  const handleDeleteApplication = async () => {
    if (!applicationToDelete) return;
    try {
      await authClient.deleteApplication(applicationToDelete);
      setApplications(applications.filter((a) => a.id !== applicationToDelete));
      setApplicationToDelete(undefined);
      toast.success("Application deleted");
    } catch (error: unknown) {
      toast.error(
        error instanceof Error ? error.message : "Failed to delete application"
      );
    }
  };

  const handleRegenerateSecret = async (appId: string, appName: string) => {
    try {
      const result = await authClient.regenerateApplicationSecret(appId);
      setNewSecretDialog({
        open: true,
        secret: result.secret,
        applicationName: appName,
      });
      toast.success("Secret regenerated");
    } catch (error: unknown) {
      toast.error(
        error instanceof Error ? error.message : "Failed to regenerate secret"
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
    canReadUsers.allowed ||
    canReadRoles.allowed ||
    canManageStrategies.allowed ||
    canManageApplications.allowed;

  if (!hasAnyPermission) {
    return <PermissionDenied />;
  }

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
          {
            id: "applications",
            label: "Applications",
            icon: <Key size={18} />,
          },
        ]}
        activeTab={activeTab}
        onTabChange={(tabId) =>
          setActiveTab(
            tabId as "users" | "roles" | "strategies" | "applications"
          )
        }
        className="mb-6"
      />

      <TabPanel id="users" activeTab={activeTab}>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>User Management</CardTitle>
            {canCreateUsers.allowed &&
              strategies.some((s) => s.id === "credential" && s.enabled) && (
                <Button onClick={() => setCreateUserDialogOpen(true)} size="sm">
                  <Plus className="h-4 w-4 mr-2" />
                  Create User
                </Button>
              )}
          </CardHeader>
          <CardContent>
            <Alert variant="info" className="mb-4">
              <AlertDescription>
                You cannot modify roles for your own account. This security
                measure prevents accidental self-lockout from the system and
                permission elevation.
              </AlertDescription>
            </Alert>
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
                          <div className="flex flex-wrap flex-col gap-2">
                            {roles
                              .filter((role) => role.isAssignable !== false)
                              .map((role) => (
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
                            <span className="text-sm text-muted-foreground">
                              {role.permissions?.length || 0} permissions
                            </span>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-2">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleEditRole(role)}
                                disabled={!canUpdateRoles.allowed}
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
            <AuthStrategyCard
              key={strategy.id}
              strategy={strategy}
              onToggle={async (id, enabled) => {
                await handleToggleStrategy(id, enabled);
              }}
              onSaveConfig={async (id, config) => {
                // Update local config state and save
                setStrategyConfigs({
                  ...strategyConfigs,
                  [id]: config,
                });
                await handleSaveStrategyConfig(id);
              }}
              disabled={!canManageStrategies.allowed}
              expanded={expandedStrategy === strategy.id}
              onExpandedChange={(isExpanded) => {
                setExpandedStrategy(isExpanded ? strategy.id : undefined);
              }}
              config={strategyConfigs[strategy.id]}
            />
          ))}

          {!canManageStrategies.allowed && (
            <p className="text-xs text-muted-foreground mt-4">
              You don't have permission to manage strategies.
            </p>
          )}
        </div>
      </TabPanel>

      <TabPanel id="applications" activeTab={activeTab}>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>External Applications</CardTitle>
            {canManageApplications.allowed && (
              <Button onClick={() => setCreateAppDialogOpen(true)} size="sm">
                <Plus className="h-4 w-4 mr-2" />
                Create Application
              </Button>
            )}
          </CardHeader>
          <CardContent>
            <Alert variant="info" className="mb-4">
              <AlertDescription>
                External applications use API keys to authenticate with the
                Checkmate API. The secret is only shown once when created—store
                it securely.
              </AlertDescription>
            </Alert>

            {loadingApplications ? (
              <div className="flex justify-center py-4">
                <LoadingSpinner />
              </div>
            ) : applications.length === 0 ? (
              <p className="text-muted-foreground">
                No external applications configured yet.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Application</TableHead>
                    <TableHead>Roles</TableHead>
                    <TableHead>Last Used</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {applications.map((app) => (
                    <TableRow key={app.id}>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-medium">{app.name}</span>
                          {app.description && (
                            <span className="text-xs text-muted-foreground">
                              {app.description}
                            </span>
                          )}
                          <span className="text-xs text-muted-foreground font-mono">
                            ID: {app.id}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap flex-col gap-2">
                          {roles
                            .filter((role) => role.isAssignable !== false)
                            .map((role) => (
                              <div
                                key={role.id}
                                className="flex items-center space-x-2"
                              >
                                <Checkbox
                                  id={`app-role-${app.id}-${role.id}`}
                                  checked={app.roles.includes(role.id)}
                                  disabled={!canManageApplications.allowed}
                                  onCheckedChange={() =>
                                    handleToggleApplicationRole(
                                      app.id,
                                      role.id,
                                      app.roles
                                    )
                                  }
                                />
                                <label
                                  htmlFor={`app-role-${app.id}-${role.id}`}
                                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                                >
                                  {role.name}
                                </label>
                              </div>
                            ))}
                        </div>
                      </TableCell>
                      <TableCell>
                        {app.lastUsedAt ? (
                          <span className="text-sm">
                            {new Date(app.lastUsedAt).toLocaleDateString()}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            Never
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              handleRegenerateSecret(app.id, app.name)
                            }
                            title="Regenerate Secret"
                          >
                            <RotateCcw className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setApplicationToDelete(app.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}

            {!canManageApplications.allowed && (
              <p className="text-xs text-muted-foreground mt-4">
                You don't have permission to manage applications.
              </p>
            )}
          </CardContent>
        </Card>
      </TabPanel>

      {/* Delete Application Confirmation */}
      <ConfirmationModal
        isOpen={!!applicationToDelete}
        onClose={() => setApplicationToDelete(undefined)}
        onConfirm={handleDeleteApplication}
        title="Delete Application"
        message="Are you sure you want to delete this application? Its API key will stop working immediately."
      />

      {/* New Secret Display Dialog */}
      <Dialog
        open={newSecretDialog.open}
        onOpenChange={(open) => {
          if (!open) {
            setNewSecretDialog({
              open: false,
              secret: "",
              applicationName: "",
            });
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Application Secret: {newSecretDialog.applicationName}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Alert variant="warning">
              <AlertDescription>
                Copy this secret now—it will never be shown again!
              </AlertDescription>
            </Alert>
            <div className="flex items-center gap-2">
              <code className="flex-1 bg-muted p-2 rounded font-mono text-sm break-all">
                {newSecretDialog.secret}
              </code>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  navigator.clipboard.writeText(newSecretDialog.secret);
                  toast.success("Secret copied to clipboard");
                }}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={() =>
                setNewSecretDialog({
                  open: false,
                  secret: "",
                  applicationName: "",
                })
              }
            >
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Application Dialog */}
      <Dialog
        open={createAppDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            setCreateAppDialogOpen(false);
            setNewAppName("");
            setNewAppDescription("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Application</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Name</label>
              <input
                type="text"
                value={newAppName}
                onChange={(e) => setNewAppName(e.target.value)}
                className="w-full px-3 py-2 border rounded-md bg-background"
                placeholder="My Application"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">
                Description (optional)
              </label>
              <input
                type="text"
                value={newAppDescription}
                onChange={(e) => setNewAppDescription(e.target.value)}
                className="w-full px-3 py-2 border rounded-md bg-background"
                placeholder="What does this application do?"
              />
            </div>
            <Alert variant="info">
              <AlertDescription>
                New applications are assigned the "Applications" role by
                default. You can manage roles after creation.
              </AlertDescription>
            </Alert>
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setCreateAppDialogOpen(false);
                setNewAppName("");
                setNewAppDescription("");
              }}
            >
              Cancel
            </Button>
            <Button onClick={() => void handleCreateApplication()}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmationModal
        isOpen={!!userToDelete}
        onClose={() => setUserToDelete(undefined)}
        onConfirm={handleDeleteUser}
        title="Delete User"
        message="Are you sure you want to delete this user? This action cannot be undone."
      />

      <RoleDialog
        open={roleDialogOpen}
        onOpenChange={setRoleDialogOpen}
        role={editingRole}
        permissions={permissions}
        isUserRole={
          editingRole
            ? users
                .find((u) => u.id === session.data?.user?.id)
                ?.roles?.includes(editingRole.id) ?? false
            : false
        }
        onSave={handleSaveRole}
      />

      <ConfirmationModal
        isOpen={!!roleToDelete}
        onClose={() => setRoleToDelete(undefined)}
        onConfirm={handleDeleteRole}
        title="Delete Role"
        message="Are you sure you want to delete this role? This action cannot be undone."
      />

      <CreateUserDialog
        open={createUserDialogOpen}
        onOpenChange={setCreateUserDialogOpen}
        onSubmit={handleCreateUser}
      />
    </PageLayout>
  );
};
