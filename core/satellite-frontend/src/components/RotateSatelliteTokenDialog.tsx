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
import { Copy, AlertTriangle, RefreshCw } from "lucide-react";

interface Props {
  satellite: SatelliteWithStatus | undefined;
  onClose: () => void;
  onRotated: () => void;
}

interface RotatedCredentials {
  clientId: string;
  token: string;
}

/**
 * Two-phase dialog: confirm intent → rotate → reveal new credentials once.
 * Used for both ad-hoc resets and the GitOps "claim my token" workflow,
 * since GitOps-managed satellites never receive a token via YAML.
 */
export const RotateSatelliteTokenDialog: React.FC<Props> = ({
  satellite,
  onClose,
  onRotated,
}) => {
  const satelliteClient = usePluginClient(SatelliteApi);
  const toast = useToast();
  const [credentials, setCredentials] = useState<RotatedCredentials | undefined>();

  useEffect(() => {
    if (!satellite) setCredentials(undefined);
  }, [satellite]);

  const rotateMutation = satelliteClient.rotateSatelliteToken.useMutation({
    onSuccess: (data) => {
      setCredentials({
        clientId: data.satellite.id,
        token: data.token,
      });
      toast.success("Satellite token rotated");
      onRotated();
    },
    onError: (error) => {
      toastError(toast, "Failed to rotate token", error);
    },
  });

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copied to clipboard`);
    } catch {
      toast.error("Failed to copy to clipboard");
    }
  };

  const handleClose = () => {
    setCredentials(undefined);
    onClose();
  };

  if (!satellite) return null;

  if (credentials) {
    return (
      <Dialog open onOpenChange={handleClose}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Token Issued</DialogTitle>
            <DialogDescription>
              Save the new token securely - the previous token has been
              invalidated and the new one will not be shown again.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="rounded-md border border-warning/50 bg-warning/10 p-3 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-warning mt-0.5 shrink-0" />
              <p className="text-sm text-warning">
                Update the satellite&apos;s configuration with this token. Any
                running satellite still using the previous token will be
                disconnected.
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="rotated-client-id">Client ID</Label>
              <div className="flex gap-2">
                <Input
                  id="rotated-client-id"
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
              <Label htmlFor="rotated-token">New Token</Label>
              <div className="flex gap-2">
                <Input
                  id="rotated-token"
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
              <pre className="rounded-md bg-surface-inset p-3 text-xs font-mono overflow-x-auto">
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

  return (
    <Dialog open onOpenChange={handleClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reset Satellite Token</DialogTitle>
          <DialogDescription>
            Issue a new token for satellite &ldquo;{satellite.name}&rdquo;. The
            existing token will stop working immediately.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border border-warning/50 bg-warning/10 p-3 flex items-start gap-2 my-2">
          <AlertTriangle className="h-4 w-4 text-warning mt-0.5 shrink-0" />
          <p className="text-sm text-warning">
            Any running satellite using the previous token will be disconnected
            until reconfigured with the new one.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            onClick={() => rotateMutation.mutate({ id: satellite.id })}
            disabled={rotateMutation.isPending}
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            {rotateMutation.isPending ? "Rotating..." : "Rotate Token"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
