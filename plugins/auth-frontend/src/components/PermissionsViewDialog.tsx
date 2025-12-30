import React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Badge,
} from "@checkmate/ui";
import { Check } from "lucide-react";
import type { Role, Permission } from "../api";

interface PermissionsViewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  role?: Role;
  permissions: Permission[];
}

export const PermissionsViewDialog: React.FC<PermissionsViewDialogProps> = ({
  open,
  onOpenChange,
  role,
  permissions,
}) => {
  if (!role) return;

  // Group permissions by plugin
  const permissionsByPlugin: Record<string, Permission[]> = {};
  for (const perm of permissions) {
    const [plugin] = perm.id.split(".");
    if (!permissionsByPlugin[plugin]) {
      permissionsByPlugin[plugin] = [];
    }
    permissionsByPlugin[plugin].push(perm);
  }

  const rolePermissions = new Set(role.permissions || []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Permissions for {role.name}</DialogTitle>
          {role.description && (
            <p className="text-sm text-muted-foreground mt-2">
              {role.description}
            </p>
          )}
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>
              {rolePermissions.size} of {permissions.length} permissions
              assigned
            </span>
          </div>

          <div className="border rounded-lg">
            <Accordion
              type="multiple"
              defaultValue={Object.keys(permissionsByPlugin)}
              className="w-full"
            >
              {Object.entries(permissionsByPlugin).map(([plugin, perms]) => {
                const assignedCount = perms.filter((p) =>
                  rolePermissions.has(p.id)
                ).length;

                return (
                  <AccordionItem key={plugin} value={plugin}>
                    <AccordionTrigger className="px-4 hover:no-underline">
                      <div className="flex items-center justify-between flex-1 pr-2">
                        <span className="font-semibold capitalize">
                          {plugin.replaceAll("-", " ")}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {assignedCount} / {perms.length} assigned
                        </span>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="px-4">
                      <div className="space-y-2 pt-2">
                        {perms.map((perm) => {
                          const isAssigned = rolePermissions.has(perm.id);
                          return (
                            <div
                              key={perm.id}
                              className={`flex items-start space-x-3 p-3 rounded-md transition-colors ${
                                isAssigned
                                  ? "bg-success/10 border border-success/20"
                                  : "bg-muted/30"
                              }`}
                            >
                              <div className="mt-0.5">
                                {isAssigned ? (
                                  <Check
                                    className="h-4 w-4 text-success"
                                    strokeWidth={3}
                                  />
                                ) : (
                                  <div className="h-4 w-4" />
                                )}
                              </div>
                              <div className="flex-1 space-y-1">
                                <div className="flex items-center gap-2">
                                  <div className="font-medium text-sm">
                                    {perm.id}
                                  </div>
                                  {isAssigned && (
                                    <Badge
                                      variant="success"
                                      className="text-xs"
                                    >
                                      Assigned
                                    </Badge>
                                  )}
                                </div>
                                {perm.description && (
                                  <div className="text-xs text-muted-foreground">
                                    {perm.description}
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                );
              })}
            </Accordion>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
