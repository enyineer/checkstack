import React, { useState } from "react";
import { usePluginClient } from "@checkstack/frontend-api";
import { IncidentApi } from "../api";
import type {
  IncidentStatus,
  IncidentUpdate,
  IncidentVisibility,
} from "@checkstack/incident-common";
import { IncidentVisibilityEnum } from "@checkstack/incident-common";
import {
  Button,
  Textarea,
  Label,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  DateTimePicker,
  useToast,
  Spinner,
  toastError,
} from "@checkstack/ui";
import { validateIncidentUpdate } from "../utils/incident.logic";
import { presentIncidentStatus } from "../utils/badges";
import { INCIDENT_VISIBILITY_OPTIONS } from "../utils/visibilityOptions";

interface IncidentUpdateFormProps {
  incidentId: string;
  /** The incident's current status, shown inline on the "Keep Current" option. */
  currentStatus: IncidentStatus;
  onSuccess: () => void;
  onCancel?: () => void;
  /**
   * When set, the form edits this existing update in place (Item 2) instead of
   * posting a new one: fields are pre-filled and submit calls `editUpdate`.
   */
  editing?: IncidentUpdate;
}

/**
 * Reusable form for adding (or editing) status updates on an incident.
 * Used in both IncidentDetailPage and IncidentEditor.
 */
export const IncidentUpdateForm: React.FC<IncidentUpdateFormProps> = ({
  incidentId,
  currentStatus,
  onSuccess,
  onCancel,
  editing,
}) => {
  const incidentClient = usePluginClient(IncidentApi);
  const toast = useToast();

  const [message, setMessage] = useState(editing?.message ?? "");
  const [statusChange, setStatusChange] = useState<IncidentStatus | "">(
    editing?.statusChange ?? "",
  );
  // Audience for this update. Defaults to `public`; `logged_in` restricts it to
  // signed-in users and `internal` makes it an operator-only note that only
  // incident managers can see and that never broadcasts to subscribers.
  const [visibility, setVisibility] = useState<IncidentVisibility>(
    editing?.visibility ?? "public",
  );
  // Published time of the update. Editable only when editing an existing update;
  // re-timing re-orders the timeline (and can re-derive the incident status).
  const [publishedAt, setPublishedAt] = useState<Date | undefined>(
    editing ? new Date(editing.createdAt) : undefined,
  );

  const isEditing = Boolean(editing);

  const addUpdateMutation = incidentClient.addUpdate.useMutation({
    onSuccess: () => {
      toast.success("Update posted");
      setMessage("");
      setStatusChange("");
      setVisibility("public");
      onSuccess();
    },
    onError: (error) => {
      toastError(toast, "Failed to post update", error);
    },
  });

  const editUpdateMutation = incidentClient.editUpdate.useMutation({
    onSuccess: () => {
      toast.success("Update saved");
      onSuccess();
    },
    onError: (error) => {
      toastError(toast, "Failed to save update", error);
    },
  });

  const handleSubmit = () => {
    const validation = validateIncidentUpdate({ message });
    if (!validation.ok) {
      toast.error(validation.error);
      return;
    }

    if (editing) {
      editUpdateMutation.mutate({
        id: editing.id,
        incidentId,
        message,
        statusChange: statusChange || undefined,
        visibility,
        // Only send a new time when the picker holds a valid value; omitting it
        // leaves the published time unchanged.
        createdAt: publishedAt,
      });
      return;
    }

    addUpdateMutation.mutate({
      incidentId,
      message,
      statusChange: statusChange || undefined,
      visibility,
    });
  };

  const pending = addUpdateMutation.isPending || editUpdateMutation.isPending;

  return (
    <div className="p-4 bg-surface-inset rounded-lg border space-y-3">
      <div className="grid gap-2">
        <Label htmlFor="updateMessage">Update Message</Label>
        <Textarea
          id="updateMessage"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Describe the status update..."
          rows={2}
        />
        <p className="text-xs text-muted-foreground">
          Markdown supported (bold, links, lists).
        </p>
      </div>
      <div className="grid gap-2">
        <Label>Change Status (Optional)</Label>
        <Select
          value={statusChange || "__keep_current__"}
          onValueChange={(v) =>
            setStatusChange(
              v === "__keep_current__" ? "" : (v as IncidentStatus),
            )
          }
        >
          <SelectTrigger>
            <SelectValue placeholder="Keep current status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__keep_current__">
              {`Keep Current (${presentIncidentStatus(currentStatus).label})`}
            </SelectItem>
            <SelectItem value="investigating">Investigating</SelectItem>
            <SelectItem value="identified">Identified</SelectItem>
            <SelectItem value="fixing">Fixing</SelectItem>
            <SelectItem value="monitoring">Monitoring</SelectItem>
            <SelectItem value="resolved">Resolved</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-2">
        <Label>Visibility</Label>
        <Select
          value={visibility}
          onValueChange={(v) => setVisibility(IncidentVisibilityEnum.parse(v))}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {INCIDENT_VISIBILITY_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          {visibility === "internal"
            ? "Internal note - visible only to managers, never notified."
            : visibility === "logged_in"
              ? "Visible only to signed-in users, not the public."
              : "Visible to everyone, including the public status page."}
        </p>
      </div>
      {isEditing && (
        <div className="grid gap-2">
          <Label>Published Date &amp; Time</Label>
          <DateTimePicker value={publishedAt} onChange={setPublishedAt} />
          <p className="text-xs text-muted-foreground">
            Adjust when this update was published. Changing it re-orders the
            timeline.
          </p>
        </div>
      )}
      <div className="flex gap-2 justify-end">
        {onCancel && (
          <Button variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button
          size="sm"
          onClick={handleSubmit}
          disabled={pending || !message.trim()}
        >
          {pending ? (
            <>
              <Spinner size="sm" className="mr-1" />
              {isEditing ? "Saving..." : "Posting..."}
            </>
          ) : isEditing ? (
            "Save Changes"
          ) : (
            "Post Update"
          )}
        </Button>
      </div>
    </div>
  );
};
