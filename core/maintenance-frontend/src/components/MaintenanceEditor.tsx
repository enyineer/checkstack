import React, { useId, useState, useEffect } from "react";
import { usePluginClient, useApi, accessApiRef } from "@checkstack/frontend-api";
import { MaintenanceApi } from "../api";
import type {
  MaintenanceWithSystems,
  MaintenanceUpdate,
} from "@checkstack/maintenance-common";
import { maintenanceAccess } from "@checkstack/maintenance-common";
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
  DateTimePicker,
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
import { MaintenanceUpdateForm } from "./MaintenanceUpdateForm";
import { getMaintenanceStatusBadge } from "../utils/badges";
import {
  TeamAccessEditor,
  TeamOwnershipPicker,
  teamCreateErrorMessage,
} from "@checkstack/auth-frontend";
import {
  deriveMaintenanceFieldErrors,
  isMaintenanceFormValid,
  type MaintenanceFormField,
} from "./maintenanceEditor.logic";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  maintenance?: MaintenanceWithSystems;
  systems: System[];
  onSave: () => void;
}

export const MaintenanceEditor: React.FC<Props> = ({
  open,
  onOpenChange,
  maintenance,
  systems,
  onSave,
}) => {
  const maintenanceClient = usePluginClient(MaintenanceApi);
  const accessApi = useApi(accessApiRef);
  const toast = useToast();

  // Stable ids for label/field association (datetime + systems group).
  const startLabelId = useId();
  const endLabelId = useId();
  const systemsLabelId = useId();

  // Owning-team picker state (create mode only)
  const [ownerTeamId, setOwnerTeamId] = useState<string | null>(null);
  const [ownerTeamError, setOwnerTeamError] = useState<string | null>(null);
  const { allowed: allowGlobal } = accessApi.useAccess(
    maintenanceAccess.maintenance.manage,
  );

  // Maintenance fields
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [startAt, setStartAt] = useState<Date | undefined>(new Date());
  const [endAt, setEndAt] = useState<Date | undefined>(new Date());
  const [selectedSystemIds, setSelectedSystemIds] = useState<Set<string>>(
    new Set(),
  );
  const [suppressNotifications, setSuppressNotifications] = useState(false);

  // Status update fields
  const [updates, setUpdates] = useState<MaintenanceUpdate[]>([]);
  const [showUpdateForm, setShowUpdateForm] = useState(false);

  // Inline validation: a per-field error map is the single source of truth for
  // both the inline FormError messages and submit-validity. Errors are only
  // revealed for fields the user has touched (or after a submit attempt) so the
  // form does not nag while it is still being filled in.
  const [touched, setTouched] = useState<
    Partial<Record<MaintenanceFormField, boolean>>
  >({});
  const [submitAttempted, setSubmitAttempted] = useState(false);

  // Unsaved-changes guard: a dirty form intercepts close/navigation and routes
  // through a discard-confirmation modal.
  const [discardOpen, setDiscardOpen] = useState(false);

  // Query for maintenance details (only when editing)
  const { data: maintenanceDetail, refetch: refetchDetail } =
    maintenanceClient.getMaintenance.useQuery(
      { id: maintenance?.id ?? "" },
      { enabled: !!maintenance?.id && open },
    );

  // Mutations
  const createMutation = maintenanceClient.createMaintenance.useMutation({
    onSuccess: () => {
      toast.success("Maintenance created");
      onSave();
    },
    onError: (error) => {
      const inline = teamCreateErrorMessage(error);
      if (inline) {
        setOwnerTeamError(inline);
        return;
      }
      toastError(toast, "Failed to create maintenance", error);
    },
  });

  const updateMutation = maintenanceClient.updateMaintenance.useMutation({
    onSuccess: () => {
      toast.success("Maintenance updated");
      onSave();
    },
    onError: (error) => {
      toastError(toast, "Failed to update maintenance", error);
    },
  });

  const addLinkMutation = maintenanceClient.addLink.useMutation({
    onSuccess: () => {
      void refetchDetail();
    },
    onError: (error) => {
      toastError(toast, "Failed to add link", error);
    },
  });

  const removeLinkMutation = maintenanceClient.removeLink.useMutation({
    onSuccess: () => {
      void refetchDetail();
    },
    onError: (error) => {
      toastError(toast, "Failed to remove link", error);
    },
  });

  // Sync updates from query
  useEffect(() => {
    if (maintenanceDetail) {
      setUpdates(maintenanceDetail.updates);
    }
  }, [maintenanceDetail]);

  // Reset form when maintenance changes
  useEffect(() => {
    setTouched({});
    setSubmitAttempted(false);
    setDiscardOpen(false);
    if (maintenance) {
      setTitle(maintenance.title);
      setDescription(maintenance.description ?? "");
      setStartAt(new Date(maintenance.startAt));
      setEndAt(new Date(maintenance.endAt));
      setSelectedSystemIds(new Set(maintenance.systemIds));
      setSuppressNotifications(maintenance.suppressNotifications);
    } else {
      // Default to 1 hour from now to 2 hours from now
      const now = new Date();
      const start = new Date(now.getTime() + 60 * 60 * 1000);
      const end = new Date(now.getTime() + 2 * 60 * 60 * 1000);
      setTitle("");
      setDescription("");
      setStartAt(start);
      setEndAt(end);
      setSelectedSystemIds(new Set());
      setSuppressNotifications(false);
      setUpdates([]);
      setShowUpdateForm(false);
      setOwnerTeamId(null);
      setOwnerTeamError(null);
    }
  }, [maintenance, open]);

  // Per-field error map (single source of truth for inline errors + validity).
  const fieldErrors = deriveMaintenanceFieldErrors({
    title,
    selectedSystemCount: selectedSystemIds.size,
    startAt,
    endAt,
  });
  const isValid = isMaintenanceFormValid(fieldErrors);
  const showError = (field: MaintenanceFormField): string | undefined =>
    touched[field] || submitAttempted ? fieldErrors[field] : undefined;
  const markTouched = (field: MaintenanceFormField) =>
    setTouched((prev) => ({ ...prev, [field]: true }));

  // Dirty tracking: compare the live editor fields against the maintenance's
  // persisted values (or the create-mode defaults). The status-update and
  // hotlink sub-editors persist via their own mutations, so they are not part
  // of this dialog's "unsaved" surface.
  const isDirty = (() => {
    const currentSystemIds = [...selectedSystemIds].toSorted();
    if (maintenance) {
      const initialSystemIds = [...maintenance.systemIds].toSorted();
      const systemsChanged =
        initialSystemIds.length !== currentSystemIds.length ||
        initialSystemIds.some((id, i) => id !== currentSystemIds[i]);
      const startChanged =
        startAt?.getTime() !== new Date(maintenance.startAt).getTime();
      const endChanged =
        endAt?.getTime() !== new Date(maintenance.endAt).getTime();
      return (
        title !== maintenance.title ||
        description !== (maintenance.description ?? "") ||
        suppressNotifications !== maintenance.suppressNotifications ||
        startChanged ||
        endChanged ||
        systemsChanged
      );
    }
    return (
      title.trim() !== "" ||
      description.trim() !== "" ||
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
    markTouched("systems");
    setSelectedSystemIds(new Set(ids));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitAttempted(true);
    setOwnerTeamError(null);

    if (!isValid) {
      // Inline errors now reveal for every field; nothing further to do.
      return;
    }
    // Re-narrow for the mutation payloads; an empty error map already
    // guarantees both dates are present, so this branch is unreachable.
    if (!startAt || !endAt) return;

    if (maintenance) {
      updateMutation.mutate({
        id: maintenance.id,
        title,
        description: description || undefined,
        suppressNotifications,
        startAt,
        endAt,
        systemIds: [...selectedSystemIds],
      });
    } else {
      createMutation.mutate({
        title,
        description,
        suppressNotifications,
        startAt,
        endAt,
        systemIds: [...selectedSystemIds],
        teamId: ownerTeamId ?? undefined,
      });
    }
  };

  const handleUpdateSuccess = () => {
    if (maintenance) {
      void refetchDetail();
    }
    setShowUpdateForm(false);
    // Notify parent to refresh list (status may have changed)
    onSave();
  };

  const saving = createMutation.isPending || updateMutation.isPending;
  const loadingUpdates = false; // Now handled by useQuery

  const titleError = showError("title");
  const systemsError = showError("systems");
  const startError = showError("startAt");
  const endError = showError("endAt");

  return (
    <>
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
                {maintenance ? "Edit Maintenance" : "Create Maintenance"}
              </DialogTitle>
              <DialogDescription className="sr-only">
                {maintenance
                  ? "Modify the settings for this scheduled maintenance"
                  : "Schedule a new maintenance window for your systems"}
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
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    onBlur={() => markTouched("title")}
                    placeholder="Database maintenance"
                    autoFocus
                    aria-invalid={titleError ? true : undefined}
                    aria-describedby={titleError ? "title-error" : undefined}
                  />
                  <FormError id="title-error">{titleError}</FormError>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="description">Description</Label>
                  <Textarea
                    id="description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Details about the maintenance..."
                    rows={3}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div
                    className="grid gap-2"
                    role="group"
                    aria-labelledby={startLabelId}
                  >
                    <Label id={startLabelId} required>
                      Start Date &amp; Time
                    </Label>
                    <DateTimePicker
                      value={startAt}
                      onChange={(date) => {
                        markTouched("startAt");
                        setStartAt(date);
                      }}
                    />
                    <FormError>{startError}</FormError>
                  </div>
                  <div
                    className="grid gap-2"
                    role="group"
                    aria-labelledby={endLabelId}
                  >
                    <Label id={endLabelId} required>
                      End Date &amp; Time
                    </Label>
                    <DateTimePicker
                      value={endAt}
                      onChange={(date) => {
                        markTouched("endAt");
                        setEndAt(date);
                      }}
                      minDate={startAt}
                    />
                    <FormError>{endError}</FormError>
                  </div>
                </div>

                <div
                  className="grid gap-2"
                  role="group"
                  aria-labelledby={systemsLabelId}
                >
                  <Label id={systemsLabelId} required>
                    Affected Systems
                  </Label>
                  <SystemMultiSelect
                    systems={systems}
                    selectedIds={[...selectedSystemIds]}
                    onChange={handleSystemChange}
                    labelledBy={systemsLabelId}
                  />
                  <FormError>{systemsError}</FormError>
                </div>

                {/* Notification Suppression Toggle */}
                <div className="border rounded-md p-4 bg-surface-inset">
                  <div
                    className="flex items-center gap-3 cursor-pointer"
                    onClick={() =>
                      setSuppressNotifications(!suppressNotifications)
                    }
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
                        downstream dependency impact notifications will not be
                        sent for affected systems while this maintenance is
                        active.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Status Updates Section - Only show when editing */}
              {maintenance && (
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
                        type="button"
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
                      <MaintenanceUpdateForm
                        maintenanceId={maintenance.id}
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
                      renderStatusBadge={getMaintenanceStatusBadge}
                      showTimeline={false}
                      maxHeight="max-h-48"
                    />
                  )}
                </div>
              )}

              {/* Hotlinks (change tickets, runbooks, ...) — editing only */}
              {maintenance && (
                <div className="border-t pt-4">
                  <LinksEditor
                    title="Hotlinks"
                    description="Attach change tickets, runbooks, dashboards, or any URL relevant to this maintenance."
                    links={maintenanceDetail?.links ?? []}
                    busy={
                      addLinkMutation.isPending || removeLinkMutation.isPending
                    }
                    onAdd={async ({ label, url }) => {
                      await addLinkMutation.mutateAsync({
                        maintenanceId: maintenance.id,
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

              {/* Owning-team picker - only shown when creating a new maintenance */}
              {!maintenance?.id && (
                <div className="border-t pt-4">
                  <TeamOwnershipPicker
                    value={ownerTeamId}
                    onChange={(teamId) => {
                      setOwnerTeamId(teamId);
                      setOwnerTeamError(null);
                    }}
                    allowGlobal={allowGlobal}
                    error={ownerTeamError}
                    parentResourceType="catalog.system"
                    parentResourceIds={[...selectedSystemIds]}
                  />
                </div>
              )}

              {/* Team Access Editor - only shown when editing existing maintenance */}
              {maintenance?.id && (
                <TeamAccessEditor
                  resourceType="maintenance.maintenance"
                  resourceId={maintenance.id}
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
                {saving ? "Saving..." : maintenance ? "Update" : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmationModal
        isOpen={discardOpen}
        onClose={handleDiscardCancel}
        onConfirm={handleDiscardConfirm}
        title="Discard changes?"
        message="You have unsaved changes. If you leave now, they will be lost."
        confirmText="Discard"
        cancelText="Keep editing"
        variant="warning"
      />
    </>
  );
};
