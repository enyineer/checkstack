import React, { useEffect, useState } from "react";
import { usePluginClient } from "@checkstack/frontend-api";
import {
  SatelliteApi,
  type SatelliteWithStatus,
} from "@checkstack/satellite-common";
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
  useToast,
  toastError,
} from "@checkstack/ui";
import { CapabilityExplainer } from "./CapabilityExplainer";

interface Props {
  satellite: SatelliteWithStatus | undefined;
  onClose: () => void;
  onUpdated: () => void;
}

/**
 * Edit a satellite's name and region. The token is untouched - use
 * `RotateSatelliteTokenDialog` to issue a new one. Open when `satellite`
 * is defined; the fields re-seed whenever the target satellite changes.
 */
export const EditSatelliteDialog: React.FC<Props> = ({
  satellite,
  onClose,
  onUpdated,
}) => {
  const satelliteClient = usePluginClient(SatelliteApi);
  const toast = useToast();

  const [name, setName] = useState("");
  const [region, setRegion] = useState("");

  useEffect(() => {
    if (satellite) {
      setName(satellite.name);
      setRegion(satellite.region);
    }
  }, [satellite]);

  const updateMutation = satelliteClient.updateSatellite.useMutation({
    onSuccess: () => {
      toast.success("Satellite updated");
      onUpdated();
      onClose();
    },
    onError: (error) => {
      toastError(toast, "Failed to update satellite", error);
    },
  });

  const handleSubmit = () => {
    if (!satellite) return;
    if (!name.trim()) {
      toast.error("Name is required");
      return;
    }
    if (!region.trim()) {
      toast.error("Region is required");
      return;
    }

    updateMutation.mutate({
      id: satellite.id,
      name: name.trim(),
      region: region.trim(),
    });
  };

  if (!satellite) return null;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Satellite</DialogTitle>
          <DialogDescription>
            Update the satellite&apos;s name and region. The token is not
            affected.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="edit-sat-name">Name</Label>
            <Input
              id="edit-sat-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="EU West Production"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="edit-sat-region">Region</Label>
            <Input
              id="edit-sat-region"
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              placeholder="eu-west-1"
            />
            <p className="text-xs text-muted-foreground">
              A descriptive identifier for the geographic location, e.g.
              &quot;eu-west-1&quot;, &quot;us-east-2&quot;, or
              &quot;datacenter-fra&quot;.
            </p>
          </div>

          <div className="grid gap-2 rounded-lg border bg-card p-3">
            <Label>Capabilities</Label>
            <p className="text-xs text-muted-foreground">
              Advertised by the satellite agent on connect. Read-only - enable
              them via the agent&apos;s environment configuration.
            </p>
            <CapabilityExplainer capabilities={satellite.capabilities} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={updateMutation.isPending}>
            {updateMutation.isPending ? "Saving..." : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
