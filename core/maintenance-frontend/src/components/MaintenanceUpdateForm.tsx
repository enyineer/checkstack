import React, { useState } from "react";
import { usePluginClient } from "@checkstack/frontend-api";
import { MaintenanceApi } from "../api";
import type { MaintenanceStatus } from "@checkstack/maintenance-common";
import {
  Button,
  Textarea,
  Label,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  useToast,
} from "@checkstack/ui";
import { Loader2 } from "lucide-react";

interface MaintenanceUpdateFormProps {
  maintenanceId: string;
  onSuccess: () => void;
  onCancel?: () => void;
}

/**
 * Reusable form for adding status updates to a maintenance.
 * Used in both MaintenanceDetailPage and MaintenanceEditor.
 */
export const MaintenanceUpdateForm: React.FC<MaintenanceUpdateFormProps> = ({
  maintenanceId,
  onSuccess,
  onCancel,
}) => {
  const maintenanceClient = usePluginClient(MaintenanceApi);
  const toast = useToast();

  const [message, setMessage] = useState("");
  const [statusChange, setStatusChange] = useState<MaintenanceStatus | "">("");

  const addUpdateMutation = maintenanceClient.addUpdate.useMutation({
    onSuccess: () => {
      toast.success("Update posted");
      setMessage("");
      setStatusChange("");
      onSuccess();
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Failed to post update"
      );
    },
  });

  const handleSubmit = () => {
    if (!message.trim()) {
      toast.error("Update message is required");
      return;
    }

    addUpdateMutation.mutate({
      maintenanceId,
      message,
      statusChange: statusChange || undefined,
    });
  };

  return (
    <div className="p-4 bg-muted/30 rounded-lg border space-y-3">
      <div className="grid gap-2">
        <Label htmlFor="updateMessage">Update Message</Label>
        <Textarea
          id="updateMessage"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Describe the status update..."
          rows={2}
        />
      </div>
      <div className="grid gap-2">
        <Label>Change Status (Optional)</Label>
        <Select
          value={statusChange || "__keep_current__"}
          onValueChange={(v) =>
            setStatusChange(
              v === "__keep_current__" ? "" : (v as MaintenanceStatus)
            )
          }
        >
          <SelectTrigger>
            <SelectValue placeholder="Keep current status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__keep_current__">Keep Current</SelectItem>
            <SelectItem value="scheduled">Scheduled</SelectItem>
            <SelectItem value="in_progress">In Progress</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex gap-2 justify-end">
        {onCancel && (
          <Button variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button
          size="sm"
          onClick={handleSubmit}
          disabled={addUpdateMutation.isPending || !message.trim()}
        >
          {addUpdateMutation.isPending ? (
            <>
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              Posting...
            </>
          ) : (
            "Post Update"
          )}
        </Button>
      </div>
    </div>
  );
};
