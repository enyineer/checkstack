import React, { useState, useEffect } from "react";
import { useApi } from "@checkmate/frontend-api";
import { maintenanceApiRef } from "../api";
import type {
  MaintenanceWithSystems,
  MaintenanceStatus,
  MaintenanceUpdate,
} from "@checkmate/maintenance-common";
import type { System } from "@checkmate/catalog-common";
import {
  Dialog,
  DialogContent,
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
  Badge,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@checkmate/ui";
import {
  Plus,
  MessageSquare,
  Calendar,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { format } from "date-fns";

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
  const api = useApi(maintenanceApiRef);
  const toast = useToast();

  // Maintenance fields
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [startAt, setStartAt] = useState<Date>(new Date());
  const [endAt, setEndAt] = useState<Date>(new Date());
  const [selectedSystemIds, setSelectedSystemIds] = useState<Set<string>>(
    new Set()
  );
  const [saving, setSaving] = useState(false);

  // Status update fields
  const [updates, setUpdates] = useState<MaintenanceUpdate[]>([]);
  const [loadingUpdates, setLoadingUpdates] = useState(false);
  const [newUpdateMessage, setNewUpdateMessage] = useState("");
  const [newUpdateStatus, setNewUpdateStatus] = useState<
    MaintenanceStatus | ""
  >("");
  const [postingUpdate, setPostingUpdate] = useState(false);
  const [showUpdateForm, setShowUpdateForm] = useState(false);

  // Reset form when maintenance changes
  useEffect(() => {
    if (maintenance) {
      setTitle(maintenance.title);
      setDescription(maintenance.description ?? "");
      setStartAt(new Date(maintenance.startAt));
      setEndAt(new Date(maintenance.endAt));
      setSelectedSystemIds(new Set(maintenance.systemIds));
      // Load full maintenance with updates
      loadMaintenanceDetails(maintenance.id);
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
      setUpdates([]);
      setShowUpdateForm(false);
    }
    // Reset update form
    setNewUpdateMessage("");
    setNewUpdateStatus("");
  }, [maintenance, open]);

  const loadMaintenanceDetails = async (id: string) => {
    setLoadingUpdates(true);
    try {
      const detail = await api.getMaintenance({ id });
      if (detail) {
        setUpdates(detail.updates);
      }
    } catch (error) {
      console.error("Failed to load maintenance details:", error);
    } finally {
      setLoadingUpdates(false);
    }
  };

  const handleSystemToggle = (systemId: string) => {
    setSelectedSystemIds((prev) => {
      const next = new Set(prev);
      if (next.has(systemId)) {
        next.delete(systemId);
      } else {
        next.add(systemId);
      }
      return next;
    });
  };

  const handleSubmit = async () => {
    if (!title.trim()) {
      toast.error("Title is required");
      return;
    }
    if (selectedSystemIds.size === 0) {
      toast.error("At least one system must be selected");
      return;
    }
    if (endAt <= startAt) {
      toast.error("End date must be after start date");
      return;
    }

    setSaving(true);
    try {
      if (maintenance) {
        await api.updateMaintenance({
          id: maintenance.id,
          title,
          description: description || undefined,
          startAt,
          endAt,
          systemIds: [...selectedSystemIds],
        });
        toast.success("Maintenance updated");
      } else {
        await api.createMaintenance({
          title,
          description,
          startAt,
          endAt,
          systemIds: [...selectedSystemIds],
        });
        toast.success("Maintenance created");
      }
      onSave();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save";
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const handlePostUpdate = async () => {
    if (!newUpdateMessage.trim()) {
      toast.error("Update message is required");
      return;
    }
    if (!maintenance) return;

    setPostingUpdate(true);
    try {
      await api.addUpdate({
        maintenanceId: maintenance.id,
        message: newUpdateMessage,
        statusChange: newUpdateStatus || undefined,
      });
      toast.success("Update posted");
      // Reload updates
      await loadMaintenanceDetails(maintenance.id);
      setNewUpdateMessage("");
      setNewUpdateStatus("");
      setShowUpdateForm(false);
      // Notify parent to refresh list (status may have changed)
      onSave();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to post update";
      toast.error(message);
    } finally {
      setPostingUpdate(false);
    }
  };

  const getStatusBadge = (status: MaintenanceStatus) => {
    switch (status) {
      case "in_progress": {
        return <Badge variant="warning">In Progress</Badge>;
      }
      case "scheduled": {
        return <Badge variant="info">Scheduled</Badge>;
      }
      case "completed": {
        return <Badge variant="success">Completed</Badge>;
      }
      case "cancelled": {
        return <Badge variant="secondary">Cancelled</Badge>;
      }
      default: {
        return <Badge>{status}</Badge>;
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl">
        <DialogHeader>
          <DialogTitle>
            {maintenance ? "Edit Maintenance" : "Create Maintenance"}
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-6 py-4 max-h-[70vh] overflow-y-auto">
          {/* Basic Info Section */}
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="title">Title</Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Database maintenance"
              />
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
              <div className="grid gap-2">
                <Label>Start Date & Time</Label>
                <DateTimePicker value={startAt} onChange={setStartAt} />
              </div>
              <div className="grid gap-2">
                <Label>End Date & Time</Label>
                <DateTimePicker
                  value={endAt}
                  onChange={setEndAt}
                  minDate={startAt}
                />
              </div>
            </div>

            <div className="grid gap-2">
              <Label>Affected Systems</Label>
              <div className="max-h-36 overflow-y-auto border rounded-md p-3 space-y-2">
                {systems.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No systems available
                  </p>
                ) : (
                  systems.map((system) => (
                    <div
                      key={system.id}
                      className="flex items-center space-x-2 p-2 rounded hover:bg-accent cursor-pointer"
                      onClick={() => handleSystemToggle(system.id)}
                    >
                      <Checkbox
                        id={`system-${system.id}`}
                        checked={selectedSystemIds.has(system.id)}
                        onCheckedChange={() => handleSystemToggle(system.id)}
                      />
                      <Label
                        htmlFor={`system-${system.id}`}
                        className="cursor-pointer flex-1"
                      >
                        {system.name}
                      </Label>
                    </div>
                  ))
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {selectedSystemIds.size} system(s) selected
              </p>
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
                <div className="mb-4 p-4 bg-muted/30 rounded-lg border space-y-3">
                  <div className="grid gap-2">
                    <Label htmlFor="updateMessage">Update Message</Label>
                    <Textarea
                      id="updateMessage"
                      value={newUpdateMessage}
                      onChange={(e) => setNewUpdateMessage(e.target.value)}
                      placeholder="Describe the status update..."
                      rows={2}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label>Change Status (Optional)</Label>
                    <Select
                      value={newUpdateStatus}
                      onValueChange={(v) =>
                        setNewUpdateStatus(v as MaintenanceStatus | "")
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Keep current status" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">Keep Current</SelectItem>
                        <SelectItem value="in_progress">In Progress</SelectItem>
                        <SelectItem value="completed">Completed</SelectItem>
                        <SelectItem value="cancelled">Cancelled</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex gap-2 justify-end">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setShowUpdateForm(false);
                        setNewUpdateMessage("");
                        setNewUpdateStatus("");
                      }}
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      onClick={handlePostUpdate}
                      disabled={postingUpdate || !newUpdateMessage.trim()}
                    >
                      {postingUpdate ? (
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
              )}

              {/* Updates List */}
              {loadingUpdates ? (
                <div className="flex justify-center py-4">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : updates.length === 0 ? (
                <div className="flex flex-col items-center py-6 text-muted-foreground">
                  <AlertCircle className="h-8 w-8 mb-2" />
                  <p className="text-sm">No status updates yet</p>
                </div>
              ) : (
                <div className="space-y-3 max-h-48 overflow-y-auto">
                  {updates.map((update) => (
                    <div
                      key={update.id}
                      className="p-3 bg-muted/20 rounded-lg border text-sm"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-foreground">{update.message}</p>
                        {update.statusChange && (
                          <div className="shrink-0">
                            {getStatusBadge(update.statusChange)}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-1 mt-2 text-xs text-muted-foreground">
                        <Calendar className="h-3 w-3" />
                        <span>
                          {format(new Date(update.createdAt), "MMM d, HH:mm")}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? "Saving..." : maintenance ? "Update" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
