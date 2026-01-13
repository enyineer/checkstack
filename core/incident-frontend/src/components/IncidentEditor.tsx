import React, { useState, useEffect, useCallback } from "react";
import { useApi } from "@checkstack/frontend-api";
import { incidentApiRef } from "../api";
import type {
  IncidentWithSystems,
  IncidentSeverity,
  IncidentUpdate,
} from "@checkstack/incident-common";
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
} from "@checkstack/ui";
import { Plus, MessageSquare, Loader2, AlertCircle } from "lucide-react";
import { IncidentUpdateForm } from "./IncidentUpdateForm";
import { getIncidentStatusBadge } from "../utils/badges";
import { TeamAccessEditor } from "@checkstack/auth-frontend";

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
  const api = useApi(incidentApiRef);
  const toast = useToast();

  // Incident fields
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState<IncidentSeverity>("major");
  const [selectedSystemIds, setSelectedSystemIds] = useState<Set<string>>(
    new Set()
  );
  const [saving, setSaving] = useState(false);

  // Status update fields
  const [updates, setUpdates] = useState<IncidentUpdate[]>([]);
  const [loadingUpdates, setLoadingUpdates] = useState(false);
  const [showUpdateForm, setShowUpdateForm] = useState(false);

  const loadIncidentDetails = useCallback(
    async (id: string) => {
      setLoadingUpdates(true);
      try {
        const detail = await api.getIncident({ id });
        if (detail) {
          setUpdates(detail.updates);
        }
      } catch (error) {
        console.error("Failed to load incident details:", error);
      } finally {
        setLoadingUpdates(false);
      }
    },
    [api]
  );

  // Reset form when incident changes
  useEffect(() => {
    if (incident) {
      setTitle(incident.title);
      setDescription(incident.description ?? "");
      setSeverity(incident.severity);
      setSelectedSystemIds(new Set(incident.systemIds));
      // Load full incident with updates
      loadIncidentDetails(incident.id);
    } else {
      setTitle("");
      setDescription("");
      setSeverity("major");
      setSelectedSystemIds(new Set());
      setUpdates([]);
      setShowUpdateForm(false);
    }
  }, [incident, open, loadIncidentDetails]);

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

    setSaving(true);
    try {
      if (incident) {
        await api.updateIncident({
          id: incident.id,
          title,
          description: description || undefined,
          severity,
          systemIds: [...selectedSystemIds],
        });
        toast.success("Incident updated");
      } else {
        await api.createIncident({
          title,
          description,
          severity,
          systemIds: [...selectedSystemIds],
        });
        toast.success("Incident created");
      }
      onSave();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save";
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateSuccess = () => {
    if (incident) {
      loadIncidentDetails(incident.id);
    }
    setShowUpdateForm(false);
    // Notify parent to refresh list (status may have changed)
    onSave();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl">
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

        <div className="grid gap-6 py-4 max-h-[70vh] overflow-y-auto">
          {/* Basic Info Section */}
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="title">Title</Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="API degradation affecting users"
              />
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
              <Label>Severity</Label>
              <Select
                value={severity}
                onValueChange={(v) => setSeverity(v as IncidentSeverity)}
              >
                <SelectTrigger>
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
                  renderStatusBadge={getIncidentStatusBadge}
                  showTimeline={false}
                  maxHeight="max-h-48"
                />
              )}
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
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? "Saving..." : incident ? "Update" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
