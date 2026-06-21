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
  ConfirmationModal,
  ResponsiveTable,
  MobileCardList,
  useToast,
  toastError,
} from "@checkstack/ui";
import { Plus, Edit, Trash2 } from "lucide-react";
import { usePluginClient } from "@checkstack/frontend-api";
import { AuthApi } from "@checkstack/auth-common";
import type { Role, AccessRuleEntry } from "../api";
import { RoleDialog } from "./RoleDialog";

export interface RolesTabProps {
  roles: Role[];
  accessRulesList: AccessRuleEntry[];
  userRoleIds: string[];
  canReadRoles: boolean;
  canCreateRoles: boolean;
  canUpdateRoles: boolean;
  canDeleteRoles: boolean;
  onDataChange: () => Promise<void>;
}

export const RolesTab: React.FC<RolesTabProps> = ({
  roles,
  accessRulesList,
  userRoleIds,
  canReadRoles,
  canCreateRoles,
  canUpdateRoles,
  canDeleteRoles,
  onDataChange,
}) => {
  const authClient = usePluginClient(AuthApi);
  const toast = useToast();

  const [roleToDelete, setRoleToDelete] = useState<string>();
  const [roleDialogOpen, setRoleDialogOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<Role | undefined>();

  // Mutations
  const createRoleMutation = authClient.createRole.useMutation({
    onSuccess: () => {
      toast.success("Role created successfully");
      void onDataChange();
    },
    onError: (error) => {
      toastError(toast, "Failed to create role", error);
    },
  });

  const updateRoleMutation = authClient.updateRole.useMutation({
    onSuccess: () => {
      toast.success("Role updated successfully");
      void onDataChange();
    },
    onError: (error) => {
      toastError(toast, "Failed to update role", error);
    },
  });

  const deleteRoleMutation = authClient.deleteRole.useMutation({
    onSuccess: () => {
      toast.success("Role deleted successfully");
      setRoleToDelete(undefined);
      void onDataChange();
    },
    onError: (error) => {
      toastError(toast, "Failed to delete role", error);
    },
  });

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
    accessRules: string[];
  }) => {
    await (params.id
      ? updateRoleMutation.mutateAsync({
          id: params.id,
          name: params.name,
          description: params.description,
          accessRules: params.accessRules,
        })
      : createRoleMutation.mutateAsync({
          name: params.name,
          description: params.description,
          accessRules: params.accessRules,
        }));
  };

  const handleDeleteRole = () => {
    if (!roleToDelete) return;
    deleteRoleMutation.mutate(roleToDelete);
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardHeaderRow>
            <CardTitle>Role Management</CardTitle>
            {canCreateRoles && (
              <Button onClick={handleCreateRole} size="sm">
                <Plus className="h-4 w-4 mr-2" />
                Create Role
              </Button>
            )}
          </CardHeaderRow>
        </CardHeader>
        <CardContent>
          {canReadRoles ? (
            roles.length === 0 ? (
              <p className="text-muted-foreground">No roles found.</p>
            ) : (
              <>
                <ResponsiveTable className="rounded-md border bg-card">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Role</TableHead>
                        <TableHead className="text-right">Access Rules</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {roles.map((role) => {
                        const isUserRole = userRoleIds.includes(role.id);
                        const isSystem = role.isSystem;

                        return (
                          <TableRow
                            key={role.id}
                            className="hover:bg-surface-inset transition-colors"
                          >
                            <TableCell>
                              <div className="flex flex-col gap-1">
                                <span className="text-sm font-semibold text-foreground">
                                  {role.name}
                                </span>
                                {role.description && (
                                  <span className="text-xs text-muted-foreground">
                                    {role.description}
                                  </span>
                                )}
                                <div className="flex gap-2 mt-1">
                                  {isSystem && <RoleTag>System</RoleTag>}
                                  {isUserRole && (
                                    <RoleTag accent>Your Role</RoleTag>
                                  )}
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className="text-right">
                              <span className="text-sm font-semibold tabular-nums text-foreground">
                                {role.accessRules?.length || 0}
                              </span>{" "}
                              <span className="text-xs text-muted-foreground">
                                access rules
                              </span>
                            </TableCell>
                            <TableCell className="text-right">
                              <RoleActions
                                role={role}
                                isUserRole={isUserRole}
                                isSystem={isSystem}
                                canUpdateRoles={canUpdateRoles}
                                canDeleteRoles={canDeleteRoles}
                                onEdit={handleEditRole}
                                onDelete={setRoleToDelete}
                              />
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </ResponsiveTable>

                <MobileCardList>
                  {roles.map((role) => {
                    const isUserRole = userRoleIds.includes(role.id);
                    const isSystem = role.isSystem;

                    return (
                      <div key={role.id} className="group">
                        <div className="relative overflow-hidden rounded-[var(--d-card-r)] border border-border/70 bg-gradient-to-b from-surface-2 to-surface p-[var(--d-pad)] shadow-[0_1px_2px_hsl(var(--foreground)/0.04),0_10px_30px_-14px_hsl(var(--foreground)/0.12)] transition-all group-hover:-translate-y-0.5 group-hover:border-primary/40 group-hover:shadow-xl">
                          {isUserRole && (
                            <span
                              className="absolute inset-y-0 left-0 w-1 bg-primary/60"
                              aria-hidden
                            />
                          )}
                          <div className="flex items-start justify-between gap-3 pl-2">
                            <div className="min-w-0">
                              <div className="flex items-baseline gap-1.5">
                                <span className="text-3xl font-bold leading-none tabular-nums text-foreground">
                                  {role.accessRules?.length || 0}
                                </span>
                                <span className="text-xs text-muted-foreground">
                                  access rules
                                </span>
                              </div>
                              <p className="mt-2 truncate text-sm font-semibold text-foreground">
                                {role.name}
                              </p>
                              {role.description && (
                                <p className="truncate text-xs text-muted-foreground">
                                  {role.description}
                                </p>
                              )}
                              <div className="mt-2 flex flex-wrap gap-2">
                                {isSystem && <RoleTag>System</RoleTag>}
                                {isUserRole && (
                                  <RoleTag accent>Your Role</RoleTag>
                                )}
                              </div>
                            </div>
                            <RoleActions
                              role={role}
                              isUserRole={isUserRole}
                              isSystem={isSystem}
                              canUpdateRoles={canUpdateRoles}
                              canDeleteRoles={canDeleteRoles}
                              onEdit={handleEditRole}
                              onDelete={setRoleToDelete}
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </MobileCardList>
              </>
            )
          ) : (
            <p className="text-muted-foreground">
              You don't have access to view roles.
            </p>
          )}
        </CardContent>
      </Card>

      <RoleDialog
        open={roleDialogOpen}
        onOpenChange={setRoleDialogOpen}
        role={editingRole}
        accessRulesList={accessRulesList}
        isUserRole={editingRole ? userRoleIds.includes(editingRole.id) : false}
        onSave={handleSaveRole}
      />

      <ConfirmationModal
        isOpen={!!roleToDelete}
        onClose={() => setRoleToDelete(undefined)}
        onConfirm={handleDeleteRole}
        title="Delete Role"
        message="Are you sure you want to delete this role? This action cannot be undone."
      />
    </>
  );
};

/**
 * Pill-shaped role tag. The neutral variant marks a System role; the accent
 * variant marks the viewer's own role, pairing with the card's left accent
 * stripe so the "this is yours" signal reads at a glance.
 */
const RoleTag: React.FC<{ children: React.ReactNode; accent?: boolean }> = ({
  children,
  accent = false,
}) => (
  <span
    className={
      accent
        ? "inline-flex w-fit items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary"
        : "inline-flex w-fit items-center rounded-full border border-border/70 px-2.5 py-0.5 text-xs font-medium text-muted-foreground"
    }
  >
    {children}
  </span>
);

interface RoleActionsProps {
  role: Role;
  isUserRole: boolean;
  isSystem: boolean | undefined;
  canUpdateRoles: boolean;
  canDeleteRoles: boolean;
  onEdit: (role: Role) => void;
  onDelete: (roleId: string) => void;
}

/**
 * Shared per-role action buttons, rendered both in the desktop table cell
 * and the mobile card so action availability stays consistent.
 */
const RoleActions: React.FC<RoleActionsProps> = ({
  role,
  isUserRole,
  isSystem,
  canUpdateRoles,
  canDeleteRoles,
  onEdit,
  onDelete,
}) => (
  <div className="flex justify-end gap-2">
    <Button
      variant="ghost"
      size="sm"
      onClick={() => onEdit(role)}
      disabled={!canUpdateRoles}
    >
      <Edit className="h-4 w-4" />
    </Button>
    <Button
      variant="ghost"
      size="sm"
      onClick={() => onDelete(role.id)}
      disabled={isSystem || isUserRole || !canDeleteRoles}
    >
      <Trash2 className="h-4 w-4" />
    </Button>
  </div>
);
