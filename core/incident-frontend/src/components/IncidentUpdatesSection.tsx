import React, { useState } from "react";
import {
  usePluginClient,
  useApi,
  useMentions,
  accessApiRef,
} from "@checkstack/frontend-api";
import { IncidentApi } from "../api";
import type {
  IncidentSeverity,
  IncidentStatus,
  IncidentUpdate,
} from "@checkstack/incident-common";
import {
  incidentAccess,
  incidentResourceTypes,
} from "@checkstack/incident-common";
import {
  Button,
  StatusUpdateTimeline,
  TimelineDot,
  pillToneStyles,
  ConfirmationModal,
  useToast,
  toastError,
} from "@checkstack/ui";
import { Plus, MessageSquare, Pencil, Trash2 } from "lucide-react";
import { IncidentUpdateForm } from "./IncidentUpdateForm";
import { getIncidentStatusBadge } from "../utils/badges";
import { presentIncidentSeverity } from "../utils/badges.logic";
import { VisibilityBadge } from "../utils/visibilityBadge";

interface Props {
  incidentId: string;
  /** The incident's current status, shown inline on the form's "Keep Current". */
  currentStatus: IncidentStatus;
  /**
   * The incident's severity, which tints the timeline rail dots.
   *
   * Severity - not status - carries the hue for incidents: an incident row has
   * BOTH an urgency and a lifecycle, and the "at most one coloured dimension
   * per row" rule in `status-tone.ts` gives the hue to the urgency, leaving the
   * lifecycle to a neutral pill. Severity belongs to the incident rather than
   * to an individual update, so every dot in one incident's timeline shares a
   * colour; it marks WHICH incident you are reading, not which update.
   */
  severity?: IncidentSeverity;
  /** The incident's updates (already audience-filtered by the backend). */
  updates: IncidentUpdate[];
  /**
   * Called after an update is added / edited / deleted so the parent can
   * refetch its incident query and invalidate cross-plugin (healthcheck) data.
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
 * The status-updates surface shared by the incident detail page AND the incident
 * editor dialog, so both offer the exact same add / edit / delete affordances
 * (including editing an update's published time and its edit history) from one
 * implementation. Owns its own manage gate, form/edit/delete state, and the
 * delete confirmation; the parent only supplies the data and an `onChanged`
 * refresh callback.
 */
export const IncidentUpdatesSection: React.FC<Props> = ({
  incidentId,
  currentStatus,
  severity,
  updates,
  onChanged,
  showTimeline = true,
  maxHeight,
  emptyDescription = "No status updates have been posted yet.",
}) => {
  const incidentClient = usePluginClient(IncidentApi);
  const accessApi = useApi(accessApiRef);
  const toast = useToast();
  const { resolveMention } = useMentions();

  const [showUpdateForm, setShowUpdateForm] = useState(false);
  const [editingUpdate, setEditingUpdate] = useState<IncidentUpdate | null>(
    null,
  );
  const [deletingUpdate, setDeletingUpdate] = useState<IncidentUpdate | null>(
    null,
  );

  // Per-resource action gate: ORs the global manage rule with a team grant on
  // THIS incident, so team-scoped managers get the affordances too.
  const { canAccess } = accessApi.useResourceAccess({
    accessRule: incidentAccess.incident.manage,
    objectType: incidentResourceTypes.incident,
    resourceIds: [incidentId],
  });
  const canManage = canAccess(incidentId);

  const deleteUpdateMutation = incidentClient.deleteUpdate.useMutation({
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
        <IncidentUpdateForm
          key={editingUpdate?.id ?? "new"}
          incidentId={incidentId}
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
        renderStatusBadge={getIncidentStatusBadge}
        {...(severity
          ? {
              renderDot: () => (
                <TimelineDot
                  className={
                    pillToneStyles[presentIncidentSeverity(severity).tone].dot
                  }
                />
              ),
            }
          : {})}
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
              incidentId,
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
