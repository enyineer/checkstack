import React, { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  Button,
  Input,
  Label,
  Checkbox,
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Badge,
  Alert,
  AlertDescription,
} from "@checkstack/ui";
import { Check } from "lucide-react";
import type { Role, AccessRuleEntry } from "../api";

interface RoleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  role?: Role;
  accessRulesList: AccessRuleEntry[];
  /** Whether current user has this role (prevents access elevation) */
  isUserRole?: boolean;
  onSave: (params: {
    id?: string;
    name: string;
    description?: string;
    accessRules: string[];
  }) => Promise<void>;
}

export const RoleDialog: React.FC<RoleDialogProps> = ({
  open,
  onOpenChange,
  role,
  accessRulesList,
  isUserRole = false,
  onSave,
}) => {
  const [name, setName] = useState(role?.name || "");
  const [description, setDescription] = useState(role?.description || "");
  const [selectedAccessRules, setSelectedAccessRules] = useState<Set<string>>(
    new Set(role?.accessRules || [])
  );
  const [saving, setSaving] = useState(false);

  // Sync state when role prop changes (e.g., opening dialog with different role)
  React.useEffect(() => {
    setName(role?.name || "");
    setDescription(role?.description || "");
    setSelectedAccessRules(new Set(role?.accessRules || []));
  }, [role]);

  const isEditing = !!role;
  const isAdminRole = role?.id === "admin";
  // Disable access rules for admin (wildcard) or user's own roles (prevent elevation)
  const accessRulesDisabled = isAdminRole || isUserRole;

  // Group access rules by plugin
  const accessRulesByPlugin: Record<string, AccessRuleEntry[]> = {};
  for (const perm of accessRulesList) {
    const [plugin] = perm.id.split(".");
    if (!accessRulesByPlugin[plugin]) {
      accessRulesByPlugin[plugin] = [];
    }
    accessRulesByPlugin[plugin].push(perm);
  }

  const handleToggleAccessRule = (accessRuleId: string) => {
    const newSelected = new Set(selectedAccessRules);
    if (newSelected.has(accessRuleId)) {
      newSelected.delete(accessRuleId);
    } else {
      newSelected.add(accessRuleId);
    }
    setSelectedAccessRules(newSelected);
  };

  const handleSave = () => {
    setSaving(true);
    onSave({
      ...(isEditing && { id: role.id }),
      name,
      description: description || undefined,
      accessRules: [...selectedAccessRules],
    });
    // Dialog closing and saving state are managed by the parent via onDataChange callback
    onOpenChange(false);
    setSaving(false);
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
          <DialogDescription className="sr-only">
            {isEditing
              ? "Modify the settings and access rules for this role"
              : "Create a new role with specific access rules"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
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
            <Label className="text-base">Access Rules</Label>
            <p className="text-sm text-muted-foreground mt-1 mb-3">
              Select access rules to grant to this role. Access rules are
              organized by plugin.
            </p>
            {isAdminRole && (
              <Alert variant="info" className="mb-3">
                <AlertDescription>
                  The administrator role has wildcard access to all access
                  rules. These cannot be modified.
                </AlertDescription>
              </Alert>
            )}
            {!isAdminRole && isUserRole && (
              <Alert variant="info" className="mb-3">
                <AlertDescription>
                  You cannot modify access rules for a role you currently have.
                  This prevents accidental self-lockout from the system.
                </AlertDescription>
              </Alert>
            )}
            <div className="border rounded-lg">
              <Accordion
                type="multiple"
                defaultValue={Object.keys(accessRulesByPlugin)}
                className="w-full"
              >
                {Object.entries(accessRulesByPlugin).map(([plugin, perms]) => (
                  <AccordionItem key={plugin} value={plugin}>
                    <AccordionTrigger className="px-4 hover:no-underline">
                      <div className="flex items-center justify-between flex-1 pr-2">
                        <span className="font-semibold capitalize">
                          {plugin.replaceAll("-", " ")}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {
                            perms.filter((p) => selectedAccessRules.has(p.id))
                              .length
                          }{" "}
                          / {perms.length} selected
                        </span>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="px-4">
                      <div
                        className={`space-y-${
                          accessRulesDisabled ? "2" : "3"
                        } pt-2`}
                      >
                        {perms.map((perm) => {
                          const isAssigned =
                            isAdminRole || selectedAccessRules.has(perm.id);

                          // Use view-style design when access rules are disabled
                          if (accessRulesDisabled) {
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
                          }

                          // Use editable checkbox design when access rules are editable
                          return (
                            <div
                              key={perm.id}
                              className="flex items-start space-x-3 p-2 rounded-md hover:bg-muted/50 transition-colors"
                            >
                              <Checkbox
                                id={`perm-${perm.id}`}
                                checked={selectedAccessRules.has(perm.id)}
                                onCheckedChange={() =>
                                  handleToggleAccessRule(perm.id)
                                }
                                className="mt-0.5"
                              />
                              <label
                                htmlFor={`perm-${perm.id}`}
                                className="text-sm cursor-pointer flex-1 space-y-1"
                              >
                                <div className="font-medium">{perm.id}</div>
                                {perm.description && (
                                  <div className="text-xs text-muted-foreground">
                                    {perm.description}
                                  </div>
                                )}
                              </label>
                            </div>
                          );
                        })}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || !name}>
            {buttonText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
