import React, { useState } from "react";
import { usePluginClient } from "@checkstack/frontend-api";
import { SatelliteApi } from "@checkstack/satellite-common";
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
} from "@checkstack/ui";
import { Copy, AlertTriangle } from "lucide-react";
import { extractErrorMessage } from "@checkstack/common";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

interface CreatedCredentials {
  clientId: string;
  token: string;
}

export const CreateSatelliteDialog: React.FC<Props> = ({
  open,
  onOpenChange,
  onCreated,
}) => {
  const satelliteClient = usePluginClient(SatelliteApi);
  const toast = useToast();

  const [name, setName] = useState("");
  const [region, setRegion] = useState("");
  const [credentials, setCredentials] = useState<
    CreatedCredentials | undefined
  >();

  const createMutation = satelliteClient.createSatellite.useMutation({
    onSuccess: (data) => {
      setCredentials({
        clientId: data.satellite.id,
        token: data.token,
      });
      toast.success("Satellite created successfully");
      onCreated();
    },
    onError: (error) => {
      toast.error(extractErrorMessage(error, "Failed to create satellite"));
    },
  });

  const handleSubmit = () => {
    if (!name.trim()) {
      toast.error("Name is required");
      return;
    }
    if (!region.trim()) {
      toast.error("Region is required");
      return;
    }

    createMutation.mutate({
      name: name.trim(),
      region: region.trim(),
      tags: {},
    });
  };

  const handleClose = () => {
    setName("");
    setRegion("");
    setCredentials(undefined);
    onOpenChange(false);
  };

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copied to clipboard`);
    } catch {
      toast.error("Failed to copy to clipboard");
    }
  };

  // After creation, show credentials
  if (credentials) {
    return (
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Satellite Created</DialogTitle>
            <DialogDescription>
              Save these credentials securely. The token will not be shown again.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="rounded-md border border-warning/50 bg-warning/10 p-3 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-warning mt-0.5 shrink-0" />
              <p className="text-sm text-warning">
                Copy and save both values now. The token cannot be retrieved
                after closing this dialog.
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="client-id">Client ID</Label>
              <div className="flex gap-2">
                <Input
                  id="client-id"
                  value={credentials.clientId}
                  readOnly
                  className="font-mono text-sm"
                />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() =>
                    void copyToClipboard(credentials.clientId, "Client ID")
                  }
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="token">Token</Label>
              <div className="flex gap-2">
                <Input
                  id="token"
                  value={credentials.token}
                  readOnly
                  className="font-mono text-sm"
                />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() =>
                    void copyToClipboard(credentials.token, "Token")
                  }
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="grid gap-2 mt-2">
              <Label>Environment Variables</Label>
              <pre className="rounded-md bg-muted p-3 text-xs font-mono overflow-x-auto">
                {`CHECKSTACK_CORE_URL=<your-core-url>\nCHECKSTACK_SATELLITE_CLIENT_ID=${credentials.clientId}\nCHECKSTACK_SATELLITE_TOKEN=${credentials.token}`}
              </pre>
            </div>
          </div>

          <DialogFooter>
            <Button onClick={handleClose}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  // Creation form
  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Satellite</DialogTitle>
          <DialogDescription>
            Deploy a satellite node to run health checks from a remote location.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="sat-name">Name</Label>
            <Input
              id="sat-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="EU West Production"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="sat-region">Region</Label>
            <Input
              id="sat-region"
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
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={createMutation.isPending}>
            {createMutation.isPending ? "Creating..." : "Create Satellite"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
