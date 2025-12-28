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
} from "@checkmate/ui";
import { authApiRef, AuthUser, Role, AuthStrategy } from "../api";
import { permissions as authPermissions } from "@checkmate/auth-common";
import { Trash2, Shield, Settings2, Users } from "lucide-react";

export const AuthSettingsPage: React.FC = () => {
  const authApi = useApi(authApiRef);
  const permissionApi = useApi(permissionApiRef);

  const [activeTab, setActiveTab] = useState<"users" | "strategies">("users");
  const [users, setUsers] = useState<(AuthUser & { roles: string[] })[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [strategies, setStrategies] = useState<AuthStrategy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const [userToDelete, setUserToDelete] = useState<string>();

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
    } catch (error: unknown) {
      setError("Failed to fetch data");
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
      setError("Failed to delete user");
    }
  };

  const handleToggleRole = async (
    userId: string,
    roleId: string,
    currentRoles: string[]
  ) => {
    const newRoles = currentRoles.includes(roleId)
      ? currentRoles.filter((r) => r !== roleId)
      : [...currentRoles, roleId];

    try {
      await authApi.updateUserRoles(userId, newRoles);
      setUsers(
        users.map((u) => (u.id === userId ? { ...u, roles: newRoles } : u))
      );
    } catch {
      setError("Failed to update roles");
    }
  };

  const handleToggleStrategy = async (strategyId: string, enabled: boolean) => {
    try {
      await authApi.toggleStrategy(strategyId, enabled);
      setStrategies(
        strategies.map((s) => (s.id === strategyId ? { ...s, enabled } : s))
      );
    } catch {
      setError("Failed to toggle strategy");
    }
  };

  if (loading) return <LoadingSpinner />;

  return (
    <PageLayout title="Authentication Settings">
      {error && (
        <Alert variant="error" className="mb-4">
          {error}
        </Alert>
      )}

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
                                  disabled={!canManageRoles.allowed}
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
        <Card>
          <CardHeader>
            <CardTitle>Authentication Strategies</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Strategy</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {strategies.map((strategy) => (
                  <TableRow key={strategy.id}>
                    <TableCell className="capitalize">{strategy.id}</TableCell>
                    <TableCell>
                      <div className="flex items-center space-x-2">
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
                          className="text-sm font-medium leading-none"
                        >
                          {strategy.enabled ? "Enabled" : "Disabled"}
                        </label>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {!canManageStrategies.allowed && (
              <p className="text-xs text-muted-foreground mt-4">
                You don't have permission to manage strategies.
              </p>
            )}
            <Alert className="mt-6">
              <Shield className="h-4 w-4" />
              <p className="text-sm">
                Disabling a strategy will prevent users from using it to log in
                and remove it from the login screen. Changes require a backend
                restart or some time to propagate due to better-auth's
                initialization.
              </p>
            </Alert>
          </CardContent>
        </Card>
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
