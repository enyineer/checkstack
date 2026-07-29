import React, { useState } from "react";
import { usePluginClient, useMentions } from "@checkstack/frontend-api";
import { MaintenanceApi } from "../api";
import type {
  MaintenanceStatus,
  MaintenanceUpdate,
  MaintenanceVisibility,
} from "@checkstack/maintenance-common";
import { MaintenanceVisibilityEnum } from "@checkstack/maintenance-common";
import {
  Button,
  MarkdownEditor,
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
import { presentMaintenanceStatus } from "../utils/badges";
import { MAINTENANCE_VISIBILITY_OPTIONS } from "../utils/visibilityOptions";

interface MaintenanceUpdateFormProps {
  maintenanceId: string;
  /** The maintenance's current status, shown inline on "Keep Current". */
  currentStatus: MaintenanceStatus;
  onSuccess: () => void;
  onCancel?: () => void;
  /**
   * When set, the form edits this existing update in place (Item 2) instead of
   * posting a new one: fields are pre-filled and submit calls `editUpdate`.
   */
  editing?: MaintenanceUpdate;
}

/**
 * Reusable form for adding (or editing) status updates on a maintenance.
 * Used in both MaintenanceDetailPage and MaintenanceEditor.
 */
export const MaintenanceUpdateForm: React.FC<MaintenanceUpdateFormProps> = ({
  maintenanceId,
  currentStatus,
  onSuccess,
  onCancel,
  editing,
}) => {
  const maintenanceClient = usePluginClient(MaintenanceApi);
  const toast = useToast();
  // `#` opens a picker over every mentionable record type - incidents,
  // maintenances, anything a plugin registers. The reference is stored as WHAT
  // it points at, so it resolves correctly in the app, on a status page, and in
  // an email, instead of freezing one URL that is wrong in two of the three.
  const { onMentionSearch } = useMentions();

  const [message, setMessage] = useState(editing?.message ?? "");
  const [statusChange, setStatusChange] = useState<MaintenanceStatus | "">(
    editing?.statusChange ?? "",
  );
  // Audience for this update. Defaults to `public`; `logged_in` restricts it to
  // signed-in users and `internal` makes it an operator-only note that only
  // maintenance managers can see and that never broadcasts to subscribers.
  const [visibility, setVisibility] = useState<MaintenanceVisibility>(
    editing?.visibility ?? "public",
  );
  // Published time of the update. Editable only when editing an existing update;
  // re-timing re-orders the timeline (and can re-derive the maintenance status).
  const [publishedAt, setPublishedAt] = useState<Date | undefined>(
    editing ? new Date(editing.createdAt) : undefined,
  );

  const isEditing = Boolean(editing);

  const addUpdateMutation = maintenanceClient.addUpdate.useMutation({
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

  const editUpdateMutation = maintenanceClient.editUpdate.useMutation({
    onSuccess: () => {
      toast.success("Update saved");
      onSuccess();
    },
    onError: (error) => {
      toastError(toast, "Failed to save update", error);
    },
  });

  const handleSubmit = () => {
    if (!message.trim()) {
      toast.error("Update message is required");
      return;
    }

    if (editing) {
      editUpdateMutation.mutate({
        id: editing.id,
        maintenanceId,
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
      maintenanceId,
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
        <MarkdownEditor
          id="updateMessage"
          value={message}
          onChange={setMessage}
          onMentionSearch={onMentionSearch}
          placeholder="Describe the status update..."
          rows={3}
        />
        <p className="text-xs text-muted-foreground">
          Markdown supported, and <code>#</code> links another incident or
          maintenance. Switch to Preview to check how it will render.
        </p>
      </div>
      <div className="grid gap-2">
        <Label>Change Status (Optional)</Label>
        <Select
          value={statusChange || "__keep_current__"}
          onValueChange={(v) =>
            setStatusChange(
              v === "__keep_current__" ? "" : (v as MaintenanceStatus),
            )
          }
        >
          <SelectTrigger>
            <SelectValue placeholder="Keep current status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__keep_current__">
              {`Keep Current (${presentMaintenanceStatus(currentStatus).label})`}
            </SelectItem>
            <SelectItem value="scheduled">Scheduled</SelectItem>
            <SelectItem value="in_progress">In Progress</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-2">
        <Label>Visibility</Label>
        <Select
          value={visibility}
          onValueChange={(v) => setVisibility(MaintenanceVisibilityEnum.parse(v))}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MAINTENANCE_VISIBILITY_OPTIONS.map((option) => (
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
