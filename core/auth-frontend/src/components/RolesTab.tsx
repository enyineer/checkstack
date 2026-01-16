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
  Badge,
  ConfirmationModal,
  useToast,
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
      toast.error(
        error instanceof Error ? error.message : "Failed to create role"
      );
    },
  });

  const updateRoleMutation = authClient.updateRole.useMutation({
    onSuccess: () => {
      toast.success("Role updated successfully");
      void onDataChange();
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Failed to update role"
      );
    },
  });

  const deleteRoleMutation = authClient.deleteRole.useMutation({
    onSuccess: () => {
      toast.success("Role deleted successfully");
      setRoleToDelete(undefined);
      void onDataChange();
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Failed to delete role"
      );
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
    await (params.id ? updateRoleMutation.mutateAsync({
        id: params.id,
        name: params.name,
        description: params.description,
        accessRules: params.accessRules,
      }) : createRoleMutation.mutateAsync({
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
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Role Management</CardTitle>
          {canCreateRoles && (
            <Button onClick={handleCreateRole} size="sm">
              <Plus className="h-4 w-4 mr-2" />
              Create Role
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {canReadRoles ? (
            roles.length === 0 ? (
              <p className="text-muted-foreground">No roles found.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Role</TableHead>
                    <TableHead>Access Rules</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {roles.map((role) => {
                    const isUserRole = userRoleIds.includes(role.id);
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
                            {role.accessRules?.length || 0} access rules
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleEditRole(role)}
                              disabled={!canUpdateRoles}
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setRoleToDelete(role.id)}
                              disabled={
                                isSystem || isUserRole || !canDeleteRoles
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
