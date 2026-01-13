import React, { useState } from "react";
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
  Checkbox,
  Alert,
  AlertDescription,
  ConfirmationModal,
  useToast,
} from "@checkstack/ui";
import { Plus, Trash2 } from "lucide-react";
import { useApi } from "@checkstack/frontend-api";
import { rpcApiRef } from "@checkstack/frontend-api";
import { AuthApi } from "@checkstack/auth-common";
import type { AuthUser, Role, AuthStrategy } from "../api";
import { CreateUserDialog } from "./CreateUserDialog";

export interface UsersTabProps {
  users: (AuthUser & { roles: string[] })[];
  roles: Role[];
  strategies: AuthStrategy[];
  currentUserId?: string;
  canReadUsers: boolean;
  canCreateUsers: boolean;
  canManageUsers: boolean;
  canManageRoles: boolean;
  onDataChange: () => Promise<void>;
}

export const UsersTab: React.FC<UsersTabProps> = ({
  users,
  roles,
  strategies,
  currentUserId,
  canReadUsers,
  canCreateUsers,
  canManageUsers,
  canManageRoles,
  onDataChange,
}) => {
  const rpcApi = useApi(rpcApiRef);
  const authClient = rpcApi.forPlugin(AuthApi);
  const toast = useToast();

  const [userToDelete, setUserToDelete] = useState<string>();
  const [createUserDialogOpen, setCreateUserDialogOpen] = useState(false);

  const hasCredentialStrategy = strategies.some(
    (s) => s.id === "credential" && s.enabled
  );

  const handleDeleteUser = async () => {
    if (!userToDelete) return;
    try {
      await authClient.deleteUser(userToDelete);
      toast.success("User deleted successfully");
      setUserToDelete(undefined);
      await onDataChange();
    } catch (error: unknown) {
      toast.error(
        error instanceof Error ? error.message : "Failed to delete user"
      );
    }
  };

  const handleToggleRole = async (
    userId: string,
    roleId: string,
    currentRoles: string[]
  ) => {
    if (currentUserId === userId) {
      toast.error("You cannot update your own roles");
      return;
    }

    const newRoles = currentRoles.includes(roleId)
      ? currentRoles.filter((r) => r !== roleId)
      : [...currentRoles, roleId];

    try {
      await authClient.updateUserRoles({ userId, roles: newRoles });
      await onDataChange();
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to update roles";
      toast.error(message);
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
      await onDataChange();
    } catch (error: unknown) {
      toast.error(
        error instanceof Error ? error.message : "Failed to create user"
      );
      throw error;
    }
  };

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>User Management</CardTitle>
          {canCreateUsers && hasCredentialStrategy && (
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
              access elevation.
            </AlertDescription>
          </Alert>
          {canReadUsers ? (
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
                                    !canManageRoles || currentUserId === user.id
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
                        {canManageUsers &&
                          user.email !== "admin@checkstack.com" && (
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
              You don't have access to list users.
            </p>
          )}
        </CardContent>
      </Card>

      <ConfirmationModal
        isOpen={!!userToDelete}
        onClose={() => setUserToDelete(undefined)}
        onConfirm={handleDeleteUser}
        title="Delete User"
        message="Are you sure you want to delete this user? This action cannot be undone."
      />

      <CreateUserDialog
        open={createUserDialogOpen}
        onOpenChange={setCreateUserDialogOpen}
        onSubmit={handleCreateUser}
      />
    </>
  );
};
