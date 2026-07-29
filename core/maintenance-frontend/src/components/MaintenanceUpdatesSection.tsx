import React, { useState } from "react";
import {
  usePluginClient,
  useApi,
  useMentions,
  accessApiRef,
} from "@checkstack/frontend-api";
import { MaintenanceApi } from "../api";
import type {
  MaintenanceStatus,
  MaintenanceUpdate,
} from "@checkstack/maintenance-common";
import {
  maintenanceAccess,
  maintenanceResourceTypes,
} from "@checkstack/maintenance-common";
import {
  Button,
  StatusUpdateTimeline,
  TimelineDot,
  pillToneStyles,
  neutralToneStyle,
  ConfirmationModal,
  useToast,
  toastError,
} from "@checkstack/ui";
import { Plus, MessageSquare, Pencil, Trash2 } from "lucide-react";
import { MaintenanceUpdateForm } from "./MaintenanceUpdateForm";
import {
  getMaintenanceStatusBadge,
  getMaintenanceStatusTone,
} from "../utils/badges";
import { VisibilityBadge } from "../utils/visibilityBadge";

interface Props {
  maintenanceId: string;
  /** The maintenance's current status, shown inline on "Keep Current". */
  currentStatus: MaintenanceStatus;
  /** The maintenance's updates (already audience-filtered by the backend). */
  updates: MaintenanceUpdate[];
  /**
   * Called after an update is added / edited / deleted so the parent can
   * refetch its maintenance query.
   */
  onChanged: () => void;
  /** Compact timeline (no dots/line) — used inside the editor dialog. */
  showTimeline?: boolean;
  /** Max height before the timeline scrolls (e.g. "max-h-48"). */
  maxHeight?: string;
  /** Empty-state description, tailored to the surface. */
  emptyDescription?: string;
}

/**
 * The status-updates surface shared by the maintenance detail page AND the
 * maintenance editor dialog, so both offer the exact same add / edit / delete
 * affordances (including editing an update's published time and its edit
 * history) from one implementation. Owns its own manage gate, form/edit/delete
 * state, and the delete confirmation; the parent only supplies the data and an
 * `onChanged` refresh callback.
 */
export const MaintenanceUpdatesSection: React.FC<Props> = ({
  maintenanceId,
  currentStatus,
  updates,
  onChanged,
  showTimeline = true,
  maxHeight,
  emptyDescription = "No status updates have been posted yet.",
}) => {
  const maintenanceClient = usePluginClient(MaintenanceApi);
  const accessApi = useApi(accessApiRef);
  const toast = useToast();
  const { resolveMention } = useMentions();

  const [showUpdateForm, setShowUpdateForm] = useState(false);
  const [editingUpdate, setEditingUpdate] = useState<MaintenanceUpdate | null>(
    null,
  );
  const [deletingUpdate, setDeletingUpdate] = useState<MaintenanceUpdate | null>(
    null,
  );

  // Per-resource action gate: ORs the global manage rule with a team grant on
  // THIS maintenance, so team-scoped managers get the affordances too.
  const { canAccess } = accessApi.useResourceAccess({
    accessRule: maintenanceAccess.maintenance.manage,
    objectType: maintenanceResourceTypes.maintenance,
    resourceIds: [maintenanceId],
  });
  const canManage = canAccess(maintenanceId);

  const deleteUpdateMutation = maintenanceClient.deleteUpdate.useMutation({
    onSuccess: () => {
      toast.success("Update deleted");
      setDeletingUpdate(null);
      onChanged();
    },
    onError: (error) => {
      toastError(toast, "Failed to delete update", error);
    },
  });

  const isFormOpen = showUpdateForm || Boolean(editingUpdate);

  const closeForm = () => {
    setShowUpdateForm(false);
    setEditingUpdate(null);
  };

  const handleFormSuccess = () => {
    closeForm();
    onChanged();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-5 w-5 text-muted-foreground" />
          <span className="text-base font-medium">Status Updates</span>
        </div>
        {canManage && !isFormOpen && (
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

      {/* Add / edit update form (keyed so switching between updates re-seeds it). */}
      {isFormOpen && (
        <MaintenanceUpdateForm
          key={editingUpdate?.id ?? "new"}
          maintenanceId={maintenanceId}
          currentStatus={currentStatus}
          editing={editingUpdate ?? undefined}
          onSuccess={handleFormSuccess}
          onCancel={closeForm}
        />
      )}

      <StatusUpdateTimeline
        updates={updates}
        // Admin surface: the viewer already holds the read grants that got them
        // here, so mentions resolve to in-app routes.
        resolveMention={resolveMention}
        renderStatusBadge={getMaintenanceStatusBadge}
        // Maintenance has NO severity, so its lifecycle is the one coloured
        // dimension (see the "at most one coloured dimension per row" rule in
        // `status-tone.ts`). Colouring the rail dot by the update's own status
        // therefore adds no competing scale - it just makes the timeline
        // readable at a glance. Updates that change nothing stay neutral, so
        // the colour always means "the status moved here".
        renderDot={(update) =>
          update.statusChange ? (
            <TimelineDot
              className={
                pillToneStyles[getMaintenanceStatusTone(update.statusChange)]
                  .dot
              }
            />
          ) : (
            <TimelineDot className={neutralToneStyle.dot} />
          )
        }
        renderMeta={(u) => <VisibilityBadge visibility={u.visibility} />}
        renderActions={
          canManage
            ? (u) => (
                <div className="flex items-center gap-0.5">
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label="Edit update"
                    onClick={() => {
                      setEditingUpdate(u);
                      setShowUpdateForm(false);
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label="Delete update"
                    onClick={() => setDeletingUpdate(u)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )
            : undefined
        }
        showTimeline={showTimeline}
        maxHeight={maxHeight}
        emptyTitle="No status updates"
        emptyDescription={emptyDescription}
      />

      <ConfirmationModal
        isOpen={Boolean(deletingUpdate)}
        onClose={() => setDeletingUpdate(null)}
        onConfirm={() => {
          if (deletingUpdate) {
            deleteUpdateMutation.mutate({
              id: deletingUpdate.id,
              maintenanceId,
            });
          }
        }}
        title="Delete update?"
        message="This permanently removes the status update. This cannot be undone."
        confirmText="Delete"
        cancelText="Cancel"
        variant="danger"
      />
    </div>
  );
};
