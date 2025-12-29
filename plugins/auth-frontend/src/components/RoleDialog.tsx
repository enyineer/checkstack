import React, { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  Button,
  Input,
  Label,
  Checkbox,
} from "@checkmate/ui";
import type { Role, Permission } from "../api";

interface RoleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  role?: Role;
  permissions: Permission[];
  onSave: (params: {
    id: string;
    name: string;
    description?: string;
    permissions: string[];
  }) => Promise<void>;
}

export const RoleDialog: React.FC<RoleDialogProps> = ({
  open,
  onOpenChange,
  role,
  permissions,
  onSave,
}) => {
  const [id, setId] = useState(role?.id || "");
  const [name, setName] = useState(role?.name || "");
  const [description, setDescription] = useState(role?.description || "");
  const [selectedPermissions, setSelectedPermissions] = useState<Set<string>>(
    new Set(role?.permissions || [])
  );
  const [saving, setSaving] = useState(false);

  const isEditing = !!role;

  // Group permissions by plugin
  const permissionsByPlugin: Record<string, Permission[]> = {};
  for (const perm of permissions) {
    const [plugin] = perm.id.split(".");
    if (!permissionsByPlugin[plugin]) {
      permissionsByPlugin[plugin] = [];
    }
    permissionsByPlugin[plugin].push(perm);
  }

  const handleTogglePermission = (permissionId: string) => {
    const newSelected = new Set(selectedPermissions);
    if (newSelected.has(permissionId)) {
      newSelected.delete(permissionId);
    } else {
      newSelected.add(permissionId);
    }
    setSelectedPermissions(newSelected);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({
        id: isEditing ? role.id : id,
        name,
        description: description || undefined,
        permissions: [...selectedPermissions],
      });
      onOpenChange(false);
    } catch (error) {
      console.error("Failed to save role:", error);
    } finally {
      setSaving(false);
    }
  };

  let buttonText = "Create";
  if (saving) {
    buttonText = "Saving...";
  } else if (isEditing) {
    buttonText = "Update";
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit Role" : "Create Role"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {!isEditing && (
            <div>
              <Label htmlFor="role-id">Role ID</Label>
              <Input
                id="role-id"
                value={id}
                onChange={(e) => setId(e.target.value)}
                placeholder="developer"
              />
            </div>
          )}

          <div>
            <Label htmlFor="role-name">Name</Label>
            <Input
              id="role-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Developer"
            />
          </div>

          <div>
            <Label htmlFor="role-description">Description (Optional)</Label>
            <Input
              id="role-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Developers with read/write access"
            />
          </div>

          <div>
            <Label>Permissions</Label>
            <div className="mt-2 space-y-4 border rounded-md p-4 max-h-64 overflow-y-auto">
              {Object.entries(permissionsByPlugin).map(([plugin, perms]) => (
                <div key={plugin}>
                  <h4 className="font-medium text-sm mb-2 capitalize">
                    {plugin}
                  </h4>
                  <div className="space-y-2">
                    {perms.map((perm) => (
                      <div
                        key={perm.id}
                        className="flex items-center space-x-2"
                      >
                        <Checkbox
                          id={`perm-${perm.id}`}
                          checked={selectedPermissions.has(perm.id)}
                          onCheckedChange={() =>
                            handleTogglePermission(perm.id)
                          }
                        />
                        <label
                          htmlFor={`perm-${perm.id}`}
                          className="text-sm cursor-pointer flex-1"
                        >
                          <span className="font-mono text-xs">{perm.id}</span>
                          {perm.description && (
                            <span className="text-muted-foreground ml-2">
                              - {perm.description}
                            </span>
                          )}
                        </label>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving || !name || (!isEditing && !id)}
          >
            {buttonText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
