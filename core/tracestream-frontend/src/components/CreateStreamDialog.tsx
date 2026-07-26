import React, { useState } from "react";
import { useApi, usePluginClient, accessApiRef } from "@checkstack/frontend-api";
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  Input,
  Label,
  Textarea,
  FormError,
  useToast,
  toastError,
} from "@checkstack/ui";
import {
  TeamOwnershipPicker,
  teamCreateErrorMessage,
} from "@checkstack/auth-frontend";
import { TracestreamApi, tracestreamAccess } from "@checkstack/tracestream-common";
import { useNavigate } from "react-router";

export interface CreateStreamDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Create-stream dialog. The submit is gated on the contract-derived create
 * verdict via `useGatedMutation(createStream)` so the button can never drift
 * from the call it guards, and a team-scoped creator picks the owning team.
 */
export function CreateStreamDialog({
  open,
  onOpenChange,
}: CreateStreamDialogProps) {
  const client = usePluginClient(TracestreamApi);
  const accessApi = useApi(accessApiRef);
  const toast = useToast();
  const navigate = useNavigate();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [ownerTeamId, setOwnerTeamId] = useState<string | null>(null);
  const [ownerTeamError, setOwnerTeamError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);

  // Global manage verdict drives whether the creator may make a global stream.
  const { allowed: allowGlobal } = accessApi.useAccess(tracestreamAccess.manage);

  const createMutation = client.createStream.useGatedMutation({
    onSuccess: (stream) => {
      toast.success(`Created ${stream.name}`);
      reset();
      onOpenChange(false);
      navigate(`/tracestream/${stream.id}`);
    },
    onError: (error) => {
      const inline = teamCreateErrorMessage(error);
      if (inline) {
        setOwnerTeamError(inline);
        return;
      }
      toastError(toast, "Failed to create stream", error);
    },
  });

  const reset = () => {
    setName("");
    setDescription("");
    setOwnerTeamId(null);
    setOwnerTeamError(null);
    setNameError(null);
  };

  const handleClose = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setOwnerTeamError(null);
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      setNameError("Name is required");
      return;
    }
    setNameError(null);
    createMutation.mutate({
      name: trimmed,
      description: description.trim() || undefined,
      teamId: ownerTeamId ?? undefined,
    });
  };

  const saving = createMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent size="default">
        <DialogHeader>
          <DialogTitle>New trace stream</DialogTitle>
          <DialogDescription>
            A stream receives your spans over OTLP. Mint a source token and point
            your OpenTelemetry exporter at it after creating it to start
            ingesting traces.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="tracestream-name">Name</Label>
            <Input
              id="tracestream-name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (nameError) setNameError(null);
              }}
              placeholder="checkout-service"
              autoFocus
              maxLength={255}
              required
            />
            {nameError && <FormError>{nameError}</FormError>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tracestream-description">Description</Label>
            <Textarea
              id="tracestream-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Distributed traces from the checkout service"
              rows={2}
              maxLength={2000}
            />
          </div>

          <TeamOwnershipPicker
            value={ownerTeamId}
            onChange={(id) => {
              setOwnerTeamId(id);
              setOwnerTeamError(null);
            }}
            allowGlobal={allowGlobal}
            error={ownerTeamError}
          />

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleClose(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Creating..." : "Create stream"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
