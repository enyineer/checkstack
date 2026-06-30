import React, { useState, useEffect } from "react";
import { usePluginClient, useApi, accessApiRef } from "@checkstack/frontend-api";
import { IncidentApi } from "../api";
import type {
  IncidentWithSystems,
  IncidentSeverity,
  IncidentUpdate,
} from "@checkstack/incident-common";
import { incidentAccess } from "@checkstack/incident-common";
import type { System } from "@checkstack/catalog-common";
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
  Textarea,
  Checkbox,
  useToast,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  StatusUpdateTimeline,
  LinksEditor,
  toastError,
  Spinner,
  FormError,
  ConfirmationModal,
  SystemMultiSelect,
  useUnsavedChanges,
} from "@checkstack/ui";
import { Plus, MessageSquare, AlertCircle } from "lucide-react";
import { IncidentUpdateForm } from "./IncidentUpdateForm";
import { getIncidentStatusBadge } from "../utils/badges";
import { TeamAccessEditor, TeamOwnershipPicker, teamCreateErrorMessage } from "@checkstack/auth-frontend";
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
}

export const IncidentEditor: React.FC<Props> = ({
  open,
  onOpenChange,
  incident,
  systems,
  onSave,
}) => {
  const incidentClient = usePluginClient(IncidentApi);
  const accessApi = useApi(accessApiRef);
  const toast = useToast();

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
  const [selectedSystemIds, setSelectedSystemIds] = useState<Set<string>>(
    new Set(),
  );
  const [suppressNotifications, setSuppressNotifications] = useState(false);

  // Status update fields
  const [updates, setUpdates] = useState<IncidentUpdate[]>([]);
  const [loadingUpdates, _setLoadingUpdates] = useState(false);
  const [showUpdateForm, setShowUpdateForm] = useState(false);

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
      toast.success("Incident updated");
      onSave();
    },
    onError: (error) => {
      toastError(toast, "Failed to update incident", error);
    },
  });

  const addLinkMutation = incidentClient.addLink.useMutation({
    onSuccess: () => {
      void refetchDetail();
    },
    onError: (error) => {
      toastError(toast, "Failed to add link", error);
    },
  });

  const removeLinkMutation = incidentClient.removeLink.useMutation({
    onSuccess: () => {
      void refetchDetail();
    },
    onError: (error) => {
      toastError(toast, "Failed to remove link", error);
    },
  });

  // Query for incident details (only when editing)
  const { data: incidentDetail, refetch: refetchDetail } =
    incidentClient.getIncident.useQuery(
      { id: incident?.id ?? "" },
      { enabled: !!incident?.id && open },
    );

  // Sync updates from query
  useEffect(() => {
    if (incidentDetail) {
      setUpdates(incidentDetail.updates);
    }
  }, [incidentDetail]);

  // Reset form when incident changes
  useEffect(() => {
    setTouched({});
    setSubmitAttempted(false);
    setDiscardOpen(false);
    if (incident) {
      setTitle(incident.title);
      setDescription(incident.description ?? "");
      setSeverity(incident.severity);
      setSelectedSystemIds(new Set(incident.systemIds));
      setSuppressNotifications(incident.suppressNotifications);
    } else {
      setTitle("");
      setDescription("");
      setSeverity("major");
      setSelectedSystemIds(new Set());
      setSuppressNotifications(false);
      setUpdates([]);
      setShowUpdateForm(false);
      setOwnerTeamId(null);
      setOwnerTeamError(null);
    }
  }, [incident, open]);

  // Per-field error map (single source of truth for inline errors + validity).
  const fieldErrors = deriveIncidentFieldErrors({
    title,
    selectedSystemCount: selectedSystemIds.size,
  });
  const showError = (field: IncidentFieldKey): string | undefined =>
    touched[field] || submitAttempted ? fieldErrors[field] : undefined;

  // Dirty tracking: compare the live editor fields against the incident's
  // persisted values (or the create-mode defaults). The status-update and
  // hotlink sub-editors persist via their own mutations, so they are not part
  // of this dialog's "unsaved" surface.
  const isDirty = (() => {
    const initialSystemIds = incident ? incident.systemIds.toSorted() : [];
    const currentSystemIds = [...selectedSystemIds].toSorted();
    const systemsChanged =
      initialSystemIds.length !== currentSystemIds.length ||
      initialSystemIds.some((id, i) => id !== currentSystemIds[i]);
    if (incident) {
      return (
        title !== incident.title ||
        description !== (incident.description ?? "") ||
        severity !== incident.severity ||
        suppressNotifications !== incident.suppressNotifications ||
        systemsChanged
      );
    }
    return (
      title.trim() !== "" ||
      description.trim() !== "" ||
      severity !== "major" ||
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
        suppressNotifications,
        systemIds: [...selectedSystemIds],
      });
    } else {
      createMutation.mutate({
        title,
        description,
        severity,
        suppressNotifications,
        systemIds: [...selectedSystemIds],
        teamId: ownerTeamId ?? undefined,
      });
    }
  };

  const handleUpdateSuccess = () => {
    if (incident) {
      void refetchDetail();
    }
    setShowUpdateForm(false);
    // Notify parent to refresh list (status may have changed)
    onSave();
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
      <DialogContent size="xl">
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
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
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
                systems={systems}
                selectedIds={[...selectedSystemIds]}
                onChange={handleSystemChange}
                labelledBy="systems-label"
              />
              <FormError id="systems-error" className="text-xs">
                {showError("systems")}
              </FormError>
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

          {/* Status Updates Section - Only show when editing */}
          {incident && (
            <div className="border-t pt-4">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <MessageSquare className="h-4 w-4 text-muted-foreground" />
                  <Label className="text-base font-medium">
                    Status Updates
                  </Label>
                </div>
                {!showUpdateForm && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowUpdateForm(true)}
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    Add Update
                  </Button>
                )}
              </div>

              {/* Add Update Form */}
              {showUpdateForm && (
                <div className="mb-4">
                  <IncidentUpdateForm
                    incidentId={incident.id}
                    onSuccess={handleUpdateSuccess}
                    onCancel={() => setShowUpdateForm(false)}
                  />
                </div>
              )}

              {/* Updates List */}
              {loadingUpdates ? (
                <div className="flex justify-center py-4">
                  <Spinner size="lg" className="text-muted-foreground" />
                </div>
              ) : updates.length === 0 ? (
                <div className="flex flex-col items-center py-6 text-muted-foreground">
                  <AlertCircle className="h-8 w-8 mb-2" />
                  <p className="text-sm">No status updates yet</p>
                </div>
              ) : (
                <StatusUpdateTimeline
                  updates={updates}
                  renderStatusBadge={getIncidentStatusBadge}
                  showTimeline={false}
                  maxHeight="max-h-48"
                />
              )}
            </div>
          )}

          {/* Hotlinks (Jira tickets, runbooks, ...) — editing only */}
          {incident && (
            <div className="border-t pt-4">
              <LinksEditor
                title="Hotlinks"
                description="Attach Jira tickets, runbooks, dashboards, or any URL relevant to this incident."
                links={incidentDetail?.links ?? []}
                busy={
                  addLinkMutation.isPending || removeLinkMutation.isPending
                }
                onAdd={async ({ label, url }) => {
                  await addLinkMutation.mutateAsync({
                    incidentId: incident.id,
                    label,
                    url,
                  });
                }}
                onRemove={async (link) => {
                  await removeLinkMutation.mutateAsync({ id: link.id });
                }}
              />
            </div>
          )}

          {/* Team Access Editor - only shown when editing existing incident */}
          {incident?.id && (
            <TeamAccessEditor
              resourceType="incident.incident"
              resourceId={incident.id}
              compact
              expanded
            />
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
