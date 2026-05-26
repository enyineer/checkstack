import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Button,
  Input,
  Label,
  Checkbox,
} from "@checkstack/ui";
import { passwordSchema } from "@checkstack/auth-common";
import type { Role } from "../api";

interface CreateUserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Assignable roles, surfaced as an optional multi-select inside the
   * dialog so admins can pick role(s) atomically with user creation.
   * Roles where `isAssignable === false` (e.g. anonymous) are filtered
   * out by the caller before being passed in.
   */
  assignableRoles: Role[];
  onSubmit: (data: {
    name: string;
    email: string;
    password: string;
    roleIds: string[];
  }) => Promise<void>;
}

export const CreateUserDialog: React.FC<CreateUserDialogProps> = ({
  open,
  onOpenChange,
  assignableRoles,
  onSubmit,
}) => {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [selectedRoleIds, setSelectedRoleIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  // Reset form when dialog opens/closes
  useEffect(() => {
    if (!open) {
      setName("");
      setEmail("");
      setPassword("");
      setSelectedRoleIds([]);
      setValidationErrors([]);
    }
  }, [open]);

  // Validate password on change
  useEffect(() => {
    if (password) {
      const result = passwordSchema.safeParse(password);
      if (result.success) {
        setValidationErrors([]);
      } else {
        setValidationErrors(result.error.issues.map((issue) => issue.message));
      }
    } else {
      setValidationErrors([]);
    }
  }, [password]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate password before submitting
    const result = passwordSchema.safeParse(password);
    if (!result.success) {
      return;
    }

    setLoading(true);
    try {
      await onSubmit({ name, email, password, roleIds: selectedRoleIds });
      onOpenChange(false);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleRole = (roleId: string) => {
    setSelectedRoleIds((prev) =>
      prev.includes(roleId)
        ? prev.filter((id) => id !== roleId)
        : [...prev, roleId],
    );
  };

  const isValid =
    name.trim().length > 0 &&
    email.trim().length > 0 &&
    password.length > 0 &&
    validationErrors.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Create User</DialogTitle>
          <DialogDescription>
            Create a new user account with email and password credentials.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="create-name">Name</Label>
              <Input
                id="create-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="John Doe"
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="create-email">Email</Label>
              <Input
                id="create-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="john@example.com"
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="create-password">Password</Label>
              <Input
                id="create-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              {validationErrors.length > 0 && (
                <ul className="text-sm text-muted-foreground list-disc pl-5 space-y-1">
                  {validationErrors.map((error, i) => (
                    <li key={i} className="text-destructive">
                      {error}
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-xs text-muted-foreground">
                At least 8 characters with uppercase, lowercase, and number
              </p>
            </div>
            {assignableRoles.length > 0 && (
              <div className="grid gap-2">
                <Label>Roles</Label>
                <div className="flex flex-col gap-2 max-h-40 overflow-y-auto">
                  {assignableRoles.map((role) => (
                    <div
                      key={role.id}
                      className="flex items-center space-x-2"
                    >
                      <Checkbox
                        id={`create-role-${role.id}`}
                        checked={selectedRoleIds.includes(role.id)}
                        onCheckedChange={() => handleToggleRole(role.id)}
                      />
                      <label
                        htmlFor={`create-role-${role.id}`}
                        className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                      >
                        {role.name}
                      </label>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Optional. Roles are assigned immediately after the user is
                  created.
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!isValid || loading}>
              {loading ? "Creating..." : "Create User"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
