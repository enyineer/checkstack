import React, { useState } from "react";
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
  Checkbox,
  Alert,
  AlertDescription,
  ConfirmationModal,
  ResponsiveTable,
  MobileCardList,
  useToast,
  toastError,
} from "@checkstack/ui";
import { Plus, Trash2 } from "lucide-react";
import { usePluginClient } from "@checkstack/frontend-api";
import { AuthApi } from "@checkstack/auth-common";
import type { AuthUser, Role, AuthStrategy } from "../api";
import { CreateUserDialog } from "./CreateUserDialog";
import { deriveInitial } from "./identity.logic";

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
  const authClient = usePluginClient(AuthApi);
  const toast = useToast();

  const [userToDelete, setUserToDelete] = useState<string>();
  const [createUserDialogOpen, setCreateUserDialogOpen] = useState(false);

  const hasCredentialStrategy = strategies.some(
    (s) => s.id === "credential" && s.enabled,
  );

  // Mutations
  const deleteUserMutation = authClient.deleteUser.useMutation({
    onSuccess: () => {
      toast.success("User deleted successfully");
      setUserToDelete(undefined);
      void onDataChange();
    },
    onError: (error) => {
      toastError(toast, "Failed to delete user", error);
    },
  });

  const updateRolesMutation = authClient.updateUserRoles.useMutation({
    onSuccess: () => {
      void onDataChange();
    },
    onError: (error) => {
      toastError(toast, "Failed to update roles", error);
    },
  });

  const createUserMutation = authClient.createCredentialUser.useMutation({
    onError: (error) => {
      toastError(toast, "Failed to create user", error);
      throw error;
    },
  });

  const handleDeleteUser = () => {
    if (!userToDelete) return;
    deleteUserMutation.mutate(userToDelete);
  };

  const handleToggleRole = (
    userId: string,
    roleId: string,
    currentRoles: string[],
  ) => {
    if (currentUserId === userId) {
      toast.error("You cannot update your own roles");
      return;
    }

    const newRoles = currentRoles.includes(roleId)
      ? currentRoles.filter((r) => r !== roleId)
      : [...currentRoles, roleId];

    updateRolesMutation.mutate({ userId, roles: newRoles });
  };

  const handleCreateUser = async (data: {
    name: string;
    email: string;
    password: string;
    roleIds: string[];
  }) => {
    const { roleIds, ...credentials } = data;
    const { userId } = await createUserMutation.mutateAsync(credentials);

    if (roleIds.length > 0) {
      try {
        await updateRolesMutation.mutateAsync({ userId, roles: roleIds });
        toast.success("User created with roles assigned");
      } catch {
        // updateRolesMutation.onError already surfaced a toast; the user
        // record itself still exists, so flag the partial success.
        toast.warning(
          "User created, but role assignment failed. Edit the user to retry.",
        );
      }
    } else {
      toast.success("User created successfully");
    }

    await onDataChange();
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardHeaderRow>
            <CardTitle>User Management</CardTitle>
            {canCreateUsers && hasCredentialStrategy && (
              <Button onClick={() => setCreateUserDialogOpen(true)} size="sm">
                <Plus className="h-4 w-4 mr-2" />
                Create User
              </Button>
            )}
          </CardHeaderRow>
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
              <>
                <ResponsiveTable className="rounded-md border bg-card">
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
                        <TableRow
                          key={user.id}
                          className="hover:bg-surface-inset transition-colors"
                        >
                          <TableCell>
                            <div className="flex items-center gap-3">
                              <span
                                className="grid size-9 shrink-0 place-items-center rounded-full bg-surface-inset text-xs font-semibold text-muted-foreground"
                                aria-hidden
                              >
                                {deriveInitial(user)}
                              </span>
                              <div className="flex min-w-0 flex-col">
                                <span className="text-sm font-medium">
                                  {user.name || "N/A"}
                                </span>
                                <span className="text-xs text-muted-foreground">
                                  {user.email}
                                </span>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <RoleCheckboxes
                              user={user}
                              roles={roles}
                              canManageRoles={canManageRoles}
                              isSelf={currentUserId === user.id}
                              onToggleRole={handleToggleRole}
                            />
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
                </ResponsiveTable>

                <MobileCardList>
                  {users.map((user) => (
                    <div key={user.id} className="group">
                      <div className="relative overflow-hidden rounded-[var(--d-card-r)] border border-border/70 bg-gradient-to-b from-surface-2 to-surface p-[var(--d-pad)] shadow-[0_1px_2px_hsl(var(--foreground)/0.04),0_10px_30px_-14px_hsl(var(--foreground)/0.12)] transition-all group-hover:-translate-y-0.5 group-hover:border-primary/40">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex min-w-0 items-center gap-3">
                            <span
                              className="grid size-9 shrink-0 place-items-center rounded-full bg-surface-inset text-xs font-semibold text-muted-foreground"
                              aria-hidden
                            >
                              {deriveInitial(user)}
                            </span>
                            <div className="flex min-w-0 flex-col">
                              <span className="truncate text-sm font-medium">
                                {user.name || "N/A"}
                              </span>
                              <span className="truncate text-xs text-muted-foreground">
                                {user.email}
                              </span>
                            </div>
                          </div>
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
                        </div>
                        <div className="mt-3 border-t border-border/60 pt-3">
                          <p className="mb-2 text-xs font-medium text-muted-foreground">
                            Roles
                          </p>
                          <RoleCheckboxes
                            user={user}
                            roles={roles}
                            canManageRoles={canManageRoles}
                            isSelf={currentUserId === user.id}
                            onToggleRole={handleToggleRole}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </MobileCardList>
              </>
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
        assignableRoles={roles.filter((role) => role.isAssignable !== false)}
        onSubmit={handleCreateUser}
      />
    </>
  );
};

interface RoleCheckboxesProps {
  user: AuthUser & { roles: string[] };
  roles: Role[];
  canManageRoles: boolean;
  isSelf: boolean;
  onToggleRole: (
    userId: string,
    roleId: string,
    currentRoles: string[],
  ) => void;
}

/**
 * Shared per-user role assignment checkbox list, rendered both inside the
 * desktop table cell and the mobile card so the two layouts stay in sync.
 */
const RoleCheckboxes: React.FC<RoleCheckboxesProps> = ({
  user,
  roles,
  canManageRoles,
  isSelf,
  onToggleRole,
}) => (
  <div className="flex flex-wrap flex-col gap-2">
    {roles
      .filter((role) => role.isAssignable !== false)
      .map((role) => (
        <div key={role.id} className="flex items-center space-x-2">
          <Checkbox
            id={`role-${user.id}-${role.id}`}
            checked={user.roles.includes(role.id)}
            disabled={!canManageRoles || isSelf}
            onCheckedChange={() =>
              onToggleRole(user.id, role.id, user.roles)
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
);
