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
  useSeedFormOnOpen,
} from "@checkstack/ui";
import { Check } from "lucide-react";
import type { Role, AccessRuleEntry } from "../api";
import { useAccessRules } from "../hooks/useAccessRules";
import { buildClonedName } from "@checkstack/common";
import {
  getCategorySelectionState,
  groupAccessRulesByCategory,
  setCategorySelection,
} from "./role-rules.logic";

/**
 * What the dialog is doing with `role`.
 *
 * `clone` seeds every field from `role` but SAVES AS A CREATE, so the mode has
 * to be explicit - inferring "editing" from `role` being present (as this
 * dialog used to) cannot express "seeded from a role, but new".
 */
export type RoleDialogMode = "create" | "edit" | "clone";

interface RoleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The role being edited, or the role a clone is seeded from. */
  role?: Role;
  mode?: RoleDialogMode;
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
  mode = role ? "edit" : "create",
  accessRulesList,
  isUserRole = false,
  onSave,
}) => {
  const isCloning = mode === "clone";
  const seededName = role
    ? isCloning
      ? buildClonedName({ name: role.name })
      : role.name
    : "";

  const [name, setName] = useState(seededName);
  const [description, setDescription] = useState(role?.description || "");
  const [selectedAccessRules, setSelectedAccessRules] = useState<Set<string>>(
    new Set(role?.accessRules || []),
  );
  const [saving, setSaving] = useState(false);

  // Seed form state once per dialog open (not on every `role` reference
  // change) so a background refetch of the role list can't wipe in-progress edits.
  useSeedFormOnOpen(open, () => {
    setName(seededName);
    setDescription(role?.description || "");
    setSelectedAccessRules(new Set(role?.accessRules || []));
  });

  const isEditing = mode === "edit";
  // A clone always starts from a blank slate identity-wise: the admin and
  // anonymous roles are special because of their ID, and a copy of one is just
  // an ordinary role, so none of their restrictions carry over.
  const isAdminRole = !isCloning && role?.id === "admin";
  // A platform admin (wildcard `*`) already holds every access rule, so editing
  // a role they belong to cannot elevate them - exempt them from the own-role
  // lock so they can configure roles they were automatically added to (the
  // backend applies the same exemption).
  const { accessRules: viewerAccessRules } = useAccessRules();
  const isWildcardAdmin = viewerAccessRules.includes("*");
  // Disable access rules for the admin role (wildcard, not rule-editable) or the
  // viewer's own role (prevent elevation) - unless the viewer is a wildcard admin.
  const accessRulesDisabled = isAdminRole || (isUserRole && !isWildcardAdmin);
  // The anonymous role may only hold rules that a PUBLIC endpoint actually uses;
  // granting an authenticated-only rule to it is inert (the server rejects
  // unauthenticated callers before checking rules). Mirrors the backend guardrail.
  const isAnonymousRole = !isCloning && role?.id === "anonymous";
  const isBlockedForAnonymous = (perm: AccessRuleEntry): boolean =>
    isAnonymousRole &&
    perm.anonymousUsable === false &&
    !selectedAccessRules.has(perm.id);

  // Categories (one per plugin), alphabetised at both levels so a reader can
  // jump to "Satellite" or "Dependency" instead of scanning registration order.
  const categories = groupAccessRulesByCategory({ rules: accessRulesList });

  const handleToggleAccessRule = (accessRuleId: string) => {
    const newSelected = new Set(selectedAccessRules);
    if (newSelected.has(accessRuleId)) {
      newSelected.delete(accessRuleId);
    } else {
      // Defense in depth: never add a rule the anonymous role can't use (the
      // checkbox is also disabled, and the backend rejects it).
      const perm = accessRulesList.find((p) => p.id === accessRuleId);
      if (perm && isBlockedForAnonymous(perm)) return;
      newSelected.add(accessRuleId);
    }
    setSelectedAccessRules(newSelected);
  };

  /**
   * Bulk-select or clear one category. Routed through the same
   * `isBlockedForAnonymous` guard the single checkbox uses, so the bulk action
   * can never be a way around a restriction the per-rule toggle enforces.
   */
  const handleSetCategorySelection = (props: {
    rules: AccessRuleEntry[];
    select: boolean;
  }) => {
    const { rules, select } = props;
    setSelectedAccessRules(
      setCategorySelection({
        selected: selectedAccessRules,
        selectableIds: rules
          .filter((perm) => !isBlockedForAnonymous(perm))
          .map((perm) => perm.id),
        categoryIds: rules.map((perm) => perm.id),
        select,
      }),
    );
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    onSave({
      // Only a genuine edit carries an id. A clone is seeded from `role` but
      // must save as a CREATE, so its id is deliberately dropped here.
      ...(isEditing && role ? { id: role.id } : {}),
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
        <form onSubmit={handleSave}>
          <DialogHeader>
            <DialogTitle>
              {isEditing
                ? "Edit Role"
                : isCloning
                  ? "Clone Role"
                  : "Create Role"}
            </DialogTitle>
            <DialogDescription className="sr-only">
              {isEditing
                ? "Modify the settings and access rules for this role"
                : isCloning
                  ? "Create a new role starting from an existing role's access rules"
                  : "Create a new role with specific access rules"}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label htmlFor="role-name" required>
                Name
              </Label>
              <Input
                id="role-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Developer"
                required
                autoFocus
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
              {isCloning && role && (
                <Alert variant="info" className="mb-3">
                  <AlertDescription>
                    Starting from <strong>{role.name}</strong>. This creates a
                    new role - the original is left untouched, and the two are
                    not linked afterwards.
                  </AlertDescription>
                </Alert>
              )}
              {isAdminRole && (
                <Alert variant="info" className="mb-3">
                  <AlertDescription>
                    The administrator role has wildcard access to all access
                    rules. These cannot be modified.
                  </AlertDescription>
                </Alert>
              )}
              {!isAdminRole && isUserRole && !isWildcardAdmin && (
                <Alert variant="info" className="mb-3">
                  <AlertDescription>
                    You cannot modify access rules for a role you currently
                    have. This prevents accidental self-lockout from the system.
                  </AlertDescription>
                </Alert>
              )}
              {isAnonymousRole && (
                <Alert variant="info" className="mb-3">
                  <AlertDescription>
                    The anonymous role applies to signed-out visitors. Rules
                    that no public page or endpoint uses are disabled here -
                    granting them would have no effect, since anonymous visitors
                    are rejected before those rules are checked.
                  </AlertDescription>
                </Alert>
              )}
              <div className="border rounded-lg">
                <Accordion
                  type="multiple"
                  defaultValue={categories.map((category) => category.pluginId)}
                  className="w-full"
                >
                  {categories.map(
                    ({ pluginId, label, rules: perms }) => (
                      <AccordionItem key={pluginId} value={pluginId}>
                        <AccordionTrigger className="px-4 hover:no-underline">
                          <div className="flex items-center justify-between flex-1 pr-2">
                            <span className="font-semibold capitalize">
                              {label}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {
                                perms.filter((p) =>
                                  selectedAccessRules.has(p.id),
                                ).length
                              }{" "}
                              / {perms.length} selected
                            </span>
                          </div>
                        </AccordionTrigger>
                        <AccordionContent className="px-4">
                          {/* Bulk actions live INSIDE the content, not in the
                              header: AccordionTrigger renders a <button>, and a
                              nested button is invalid markup that also swallows
                              the trigger's keyboard behaviour. All categories
                              start expanded, so this is no less reachable. */}
                          {!accessRulesDisabled && (
                            <CategoryBulkActions
                              label={label}
                              state={getCategorySelectionState({
                                selected: selectedAccessRules,
                                selectableIds: perms
                                  .filter((p) => !isBlockedForAnonymous(p))
                                  .map((p) => p.id),
                              })}
                              onSelectAll={() =>
                                handleSetCategorySelection({
                                  rules: perms,
                                  select: true,
                                })
                              }
                              onClear={() =>
                                handleSetCategorySelection({
                                  rules: perms,
                                  select: false,
                                })
                              }
                            />
                          )}
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
                                        : "bg-surface-inset"
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
                              const blockedForAnonymous =
                                isBlockedForAnonymous(perm);
                              return (
                                <div
                                  key={perm.id}
                                  className={`flex items-start space-x-3 p-2 rounded-md transition-colors ${
                                    blockedForAnonymous
                                      ? "opacity-50"
                                      : "hover:bg-surface-inset"
                                  }`}
                                >
                                  <Checkbox
                                    id={`perm-${perm.id}`}
                                    checked={selectedAccessRules.has(perm.id)}
                                    disabled={blockedForAnonymous}
                                    onCheckedChange={() =>
                                      handleToggleAccessRule(perm.id)
                                    }
                                    className="mt-0.5"
                                  />
                                  <label
                                    htmlFor={`perm-${perm.id}`}
                                    className={`text-sm flex-1 space-y-1 ${
                                      blockedForAnonymous
                                        ? "cursor-not-allowed"
                                        : "cursor-pointer"
                                    }`}
                                  >
                                    <div className="font-medium">{perm.id}</div>
                                    {perm.description && (
                                      <div className="text-xs text-muted-foreground">
                                        {perm.description}
                                      </div>
                                    )}
                                    {blockedForAnonymous && (
                                      <div className="text-xs text-muted-foreground italic">
                                        Not available to anonymous visitors (no
                                        public endpoint uses this rule).
                                      </div>
                                    )}
                                  </label>
                                </div>
                              );
                            })}
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                    ),
                  )}
                </Accordion>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !name.trim()}>
              {buttonText}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

interface CategoryBulkActionsProps {
  /** Category name, used to keep the accessible labels distinguishable. */
  label: string;
  state: ReturnType<typeof getCategorySelectionState>;
  onSelectAll: () => void;
  onClear: () => void;
}

/**
 * "Select all" / "Clear" for one access-rule category.
 *
 * Both actions are always offered rather than toggling one button between two
 * meanings: from a partial selection the author usually knows which way they
 * want to go, and a single toggle would make them guess. Each is disabled when
 * it would be a no-op, so the current state is readable from the controls.
 */
const CategoryBulkActions: React.FC<CategoryBulkActionsProps> = ({
  label,
  state,
  onSelectAll,
  onClear,
}) => (
  <div className="flex items-center gap-1 border-b border-border/60 pb-2">
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-7 text-xs"
      onClick={onSelectAll}
      disabled={state === "all"}
      aria-label={`Select all ${label} access rules`}
    >
      Select all
    </Button>
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-7 text-xs"
      onClick={onClear}
      disabled={state === "none"}
      aria-label={`Clear all ${label} access rules`}
    >
      Clear
    </Button>
  </div>
);
