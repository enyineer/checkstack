import React, { useState, useEffect } from "react";
import { usePluginClient } from "@checkstack/frontend-api";
import { MaintenanceApi } from "../api";
import type {
  MaintenanceWithSystems,
  MaintenanceUpdate,
} from "@checkstack/maintenance-common";
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
} from "@checkstack/ui";
import { Plus, MessageSquare, Loader2, AlertCircle } from "lucide-react";
import { MaintenanceUpdateForm } from "./MaintenanceUpdateForm";
import { getMaintenanceStatusBadge } from "../utils/badges";
import { TeamAccessEditor } from "@checkstack/auth-frontend";

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
  const toast = useToast();

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
      toast.error(error instanceof Error ? error.message : "Failed to save");
    },
  });

  const updateMutation = maintenanceClient.updateMaintenance.useMutation({
    onSuccess: () => {
      toast.success("Maintenance updated");
      onSave();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to save");
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
    }
  }, [maintenance, open]);

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

  const handleSubmit = () => {
    if (!title.trim()) {
      toast.error("Title is required");
      return;
    }
    if (selectedSystemIds.size === 0) {
      toast.error("At least one system must be selected");
      return;
    }
    if (!startAt || !endAt) {
      toast.error("Start and end dates are required");
      return;
    }
    if (endAt <= startAt) {
      toast.error("End date must be after start date");
      return;
    }

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl">
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

            {/* Notification Suppression Toggle */}
            <div className="border rounded-md p-4 bg-muted/30">
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
                    Suppress health notifications
                  </Label>
                  <p className="text-xs text-muted-foreground mt-1">
                    When enabled, health status change notifications will not be
                    sent for affected systems while this maintenance is active.
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
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
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
