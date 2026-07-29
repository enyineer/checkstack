import React, { useState, useEffect } from "react";
import { Link } from "react-router";
import {
  usePluginClient,
  useApi,
  useQueryClient,
  accessApiRef,
} from "@checkstack/frontend-api";
import { resolveRoute } from "@checkstack/common";
import { IncidentApi } from "../api";
import type {
  IncidentWithSystems,
  IncidentSeverity,
  IncidentHealthOverride,
} from "@checkstack/incident-common";
import { incidentAccess, incidentRoutes } from "@checkstack/incident-common";
import type { System } from "@checkstack/catalog-common";
import {
  catalogAccess,
  catalogResourceTypes,
} from "@checkstack/catalog-common";
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
  MarkdownEditor,
  Checkbox,
  useToast,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  toastError,
  FormError,
  ConfirmationModal,
  SystemMultiSelect,
  useUnsavedChanges,
} from "@checkstack/ui";
import {
  TeamOwnershipPicker,
  teamCreateErrorMessage,
  useManageableResources,
} from "@checkstack/auth-frontend";
import {
  deriveIncidentFieldErrors,
  type IncidentFieldKey,
} from "../utils/incident.logic";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  incident?: IncidentWithSystems;
  systems: System[];
  onSave: () => void;
  /**
   * Systems to pre-select when opening in CREATE mode (no `incident`). Lets a
   * caller open the editor already scoped to a system - e.g. "Report incident"
   * on that system's overview page. Ignored when editing an existing incident,
   * whose own systems win.
   */
  presetSystemIds?: string[];
}

export const IncidentEditor: React.FC<Props> = ({
  open,
  onOpenChange,
  incident,
  systems,
  onSave,
  presetSystemIds,
}) => {
  const incidentClient = usePluginClient(IncidentApi);
  const accessApi = useApi(accessApiRef);
  const queryClient = useQueryClient();
  const toast = useToast();

  // An incident's health override feeds healthcheck's derived system health, a
  // DIFFERENT plugin's data, so its queries must be invalidated explicitly on
  // success (the mutation auto-invalidates only the incident plugin). See the
  // frontend query-invalidation rule (Pillar 2).
  const invalidateSystemHealth = () => {
    void queryClient.invalidateQueries({ queryKey: [["healthcheck"]] });
  };

  const { allowed: allowGlobal } = accessApi.useAccess(
    incidentAccess.incident.manage,
  );

  // Owning-team selection — create mode only
  const [ownerTeamId, setOwnerTeamId] = useState<string | null>(null);
  const [ownerTeamError, setOwnerTeamError] = useState<string | null>(null);

  // Incident fields
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState<IncidentSeverity>("major");
  // Optional health override forced onto the affected systems. "none" is the
  // sentinel for "do not touch derived health" (mapped to `null` on submit).
  const [healthOverride, setHealthOverride] = useState<
    IncidentHealthOverride | "none"
  >("none");
  const [selectedSystemIds, setSelectedSystemIds] = useState<Set<string>>(
    new Set(),
  );
  const [suppressNotifications, setSuppressNotifications] = useState(false);

  // Systems offered in the picker: everything for a global incident manager,
  // otherwise only systems the user manages, plus any already attached to the
  // incident being edited (so existing links stay visible even if unmanaged).
  // The backend requires manage on EVERY referenced system, so filtering here
  // keeps the picker consistent with what the create/update will accept.
  const { manageable: selectableSystems } = useManageableResources({
    items: systems,
    getId: (s) => s.id,
    accessRule: catalogAccess.system.manage,
    objectType: catalogResourceTypes.system,
    keepIds: selectedSystemIds,
    allowAllOverride: allowGlobal,
  });

  // Inline validation: a per-field error map is the single source of truth for
  // both the inline FormError messages and submit-validity. Errors are only
  // revealed for fields the user has touched (or after a submit attempt) so the
  // form does not nag while it is still being filled in.
  const [touched, setTouched] = useState<Partial<Record<IncidentFieldKey, boolean>>>(
    {},
  );
  const [submitAttempted, setSubmitAttempted] = useState(false);

  // Dirty tracking for the unsaved-changes guard. We snapshot the editor's
  // fields and compare against the live values; the snapshot is reset whenever
  // the dialog (re)opens for a given incident.
  const [discardOpen, setDiscardOpen] = useState(false);

  // Mutations
  const createMutation = incidentClient.createIncident.useMutation({
    onSuccess: () => {
      invalidateSystemHealth();
      toast.success("Incident created");
      onSave();
    },
    onError: (error) => {
      const inline = teamCreateErrorMessage(error);
      if (inline) {
        setOwnerTeamError(inline);
        return;
      }
      toastError(toast, "Failed to create incident", error);
    },
  });

  const updateMutation = incidentClient.updateIncident.useMutation({
    onSuccess: () => {
      invalidateSystemHealth();
      toast.success("Incident updated");
      onSave();
    },
    onError: (error) => {
      toastError(toast, "Failed to update incident", error);
    },
  });

  // Reset form when incident changes
  useEffect(() => {
    setTouched({});
    setSubmitAttempted(false);
    setDiscardOpen(false);
    if (incident) {
      setTitle(incident.title);
      setDescription(incident.description ?? "");
      setSeverity(incident.severity);
      setHealthOverride(incident.healthOverride ?? "none");
      setSelectedSystemIds(new Set(incident.systemIds));
      setSuppressNotifications(incident.suppressNotifications);
    } else {
      setTitle("");
      setDescription("");
      setSeverity("major");
      setHealthOverride("none");
      setSelectedSystemIds(new Set(presetSystemIds));
      setSuppressNotifications(false);
      setOwnerTeamId(null);
      setOwnerTeamError(null);
    }
  }, [incident, open, presetSystemIds]);

  // Per-field error map (single source of truth for inline errors + validity).
  const fieldErrors = deriveIncidentFieldErrors({
    title,
    selectedSystemCount: selectedSystemIds.size,
  });
  const showError = (field: IncidentFieldKey): string | undefined =>
    touched[field] || submitAttempted ? fieldErrors[field] : undefined;

  // Dirty tracking: compare the live editor fields against the incident's
  // persisted values (or the create-mode defaults). Status updates, hotlinks
  // and team access are self-persisting on the detail page, so they are not
  // part of this dialog's "unsaved" surface.
  const isDirty = (() => {
    // In create mode the baseline is whatever was PRE-SELECTED (e.g. opened
    // from a system's "Report incident"), not an empty set - otherwise the form
    // counts as dirty the moment it opens and closing it nags to discard.
    const initialSystemIds = incident
      ? incident.systemIds.toSorted()
      : [...(presetSystemIds ?? [])].toSorted();
    const currentSystemIds = [...selectedSystemIds].toSorted();
    const systemsChanged =
      initialSystemIds.length !== currentSystemIds.length ||
      initialSystemIds.some((id, i) => id !== currentSystemIds[i]);
    if (incident) {
      return (
        title !== incident.title ||
        description !== (incident.description ?? "") ||
        severity !== incident.severity ||
        healthOverride !== (incident.healthOverride ?? "none") ||
        suppressNotifications !== incident.suppressNotifications ||
        systemsChanged
      );
    }
    return (
      title.trim() !== "" ||
      description.trim() !== "" ||
      severity !== "major" ||
      healthOverride !== "none" ||
      suppressNotifications ||
      currentSystemIds.length > 0 ||
      ownerTeamId !== null
    );
  })();

  const { confirmDiscard, cancelDiscard, isBlocked } = useUnsavedChanges({
    isDirty: isDirty && open,
  });

  // Resolve a react-router-blocked navigation through the discard modal so the
  // in-app guard and the close-button guard share one confirmation surface.
  useEffect(() => {
    if (isBlocked) setDiscardOpen(true);
  }, [isBlocked]);

  // Close the dialog, guarding against discarding unsaved edits. A dirty form
  // opens the confirm modal instead of closing immediately.
  const requestClose = () => {
    if (isDirty) {
      setDiscardOpen(true);
      return;
    }
    onOpenChange(false);
  };

  const handleDiscardConfirm = () => {
    setDiscardOpen(false);
    if (isBlocked) {
      confirmDiscard();
      return;
    }
    onOpenChange(false);
  };

  const handleDiscardCancel = () => {
    setDiscardOpen(false);
    if (isBlocked) cancelDiscard();
  };

  const handleSystemChange = (ids: string[]) => {
    setTouched((prev) => ({ ...prev, systems: true }));
    setSelectedSystemIds(new Set(ids));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setOwnerTeamError(null);
    setSubmitAttempted(true);
    if (Object.keys(fieldErrors).length > 0) {
      return;
    }

    if (incident) {
      updateMutation.mutate({
        id: incident.id,
        title,
        description: description || undefined,
        severity,
        healthOverride: healthOverride === "none" ? null : healthOverride,
        suppressNotifications,
        systemIds: [...selectedSystemIds],
      });
    } else {
      createMutation.mutate({
        title,
        description,
        severity,
        healthOverride: healthOverride === "none" ? null : healthOverride,
        suppressNotifications,
        systemIds: [...selectedSystemIds],
        teamId: ownerTeamId ?? undefined,
      });
    }
  };

  const saving = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          requestClose();
          return;
        }
        onOpenChange(true);
      }}
    >
      <DialogContent size="lg">
        <form onSubmit={handleSubmit}>
        <DialogHeader>
          <DialogTitle>
            {incident ? "Edit Incident" : "Create Incident"}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {incident
              ? "Modify the details for this incident report"
              : "Report a new incident affecting your systems"}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 py-4">
          {/* Basic Info Section */}
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="title" required>
                Title
              </Label>
              <Input
                id="title"
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={() => setTouched((prev) => ({ ...prev, title: true }))}
                placeholder="API degradation affecting users"
                aria-invalid={Boolean(showError("title"))}
                aria-describedby={
                  showError("title") ? "title-error" : undefined
                }
              />
              <FormError id="title-error" className="text-xs">
                {showError("title")}
              </FormError>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="description">Description</Label>
              <MarkdownEditor
                id="description"
                value={description}
                onChange={setDescription}
                placeholder="Details about the incident..."
                rows={3}
              />
            </div>

            <div className="grid gap-2">
              <Label id="severity-label" required>
                Severity
              </Label>
              <Select
                value={severity}
                onValueChange={(v) => setSeverity(v as IncidentSeverity)}
              >
                <SelectTrigger aria-labelledby="severity-label">
                  <SelectValue placeholder="Select severity" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="minor">Minor</SelectItem>
                  <SelectItem value="major">Major</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label id="systems-label" required>
                Affected Systems
              </Label>
              <SystemMultiSelect
                systems={selectableSystems}
                selectedIds={[...selectedSystemIds]}
                onChange={handleSystemChange}
                labelledBy="systems-label"
              />
              <FormError id="systems-error" className="text-xs">
                {showError("systems")}
              </FormError>
            </div>

            {/* Health override — optionally force the affected systems' health */}
            <div className="grid gap-2">
              <Label id="health-override-label">Override system health</Label>
              <Select
                value={healthOverride}
                onValueChange={(v) =>
                  setHealthOverride(v as IncidentHealthOverride | "none")
                }
              >
                <SelectTrigger aria-labelledby="health-override-label">
                  <SelectValue placeholder="No override" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No override</SelectItem>
                  <SelectItem value="degraded">Degraded</SelectItem>
                  <SelectItem value="unhealthy">Unhealthy</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Forces the affected systems to this health status on every
                surface (status pages, dashboards, dependency map) while this
                incident is active, then lifts automatically when it is
                resolved. A health check reporting a worse status still wins.
                Use this for issues no automated check can detect.
              </p>
            </div>

            {/* Notification Suppression Toggle */}
            <div className="border rounded-md p-4 bg-surface-inset">
              <div
                className="flex items-center gap-3 cursor-pointer"
                onClick={() => setSuppressNotifications(!suppressNotifications)}
              >
                <Checkbox
                  id="suppress-notifications"
                  checked={suppressNotifications}
                />
                <div className="flex-1">
                  <Label
                    htmlFor="suppress-notifications"
                    className="cursor-pointer font-medium"
                  >
                    Suppress notifications
                  </Label>
                  <p className="text-xs text-muted-foreground mt-1">
                    When enabled, health status change notifications and
                    downstream dependency impact notifications will not be sent
                    for affected systems while this incident is active.
                  </p>
                </div>
              </div>
            </div>

            {/* Owning team — create mode only */}
            {!incident && (
              <TeamOwnershipPicker
                value={ownerTeamId}
                onChange={(id) => {
                  setOwnerTeamId(id);
                  setOwnerTeamError(null);
                }}
                allowGlobal={allowGlobal}
                error={ownerTeamError}
                parentResourceType="catalog.system"
                parentResourceIds={[...selectedSystemIds]}
              />
            )}
          </div>

          {/* Editing this incident's status updates, hotlinks and team access is
              done on its detail page — the living data lives there, not in this
              deferred-save form. */}
          {incident && (
            <p className="border-t pt-4 text-xs text-muted-foreground">
              Status updates, hotlinks and team access are managed on the{" "}
              <Link
                to={resolveRoute(incidentRoutes.routes.detail, {
                  incidentId: incident.id,
                })}
                onClick={() => onOpenChange(false)}
                className="text-primary underline underline-offset-2 hover:no-underline"
              >
                incident's detail page
              </Link>
              .
            </p>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={requestClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? "Saving..." : incident ? "Update" : "Create"}
          </Button>
        </DialogFooter>
        </form>
      </DialogContent>

      <ConfirmationModal
        isOpen={discardOpen}
        onClose={handleDiscardCancel}
        onConfirm={handleDiscardConfirm}
        title="Discard changes?"
        message="You have unsaved changes. Are you sure you want to discard them?"
        confirmText="Discard"
        cancelText="Keep editing"
        variant="warning"
      />
    </Dialog>
  );
};
