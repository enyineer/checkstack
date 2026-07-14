import { useEffect, useReducer } from "react";
import { usePluginClient } from "@checkstack/frontend-api";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  Button,
  useToast,
  toastError,
} from "@checkstack/ui";
import {
  TelemetryApi,
  type TelemetrySource,
} from "@checkstack/telemetry-common";
import {
  initialWebhookPanelState,
  isWebhookPanelOpen,
  webhookPanelReducer,
} from "../lib/webhook-panel.logic";
import { WebhookSecretPanel } from "./WebhookSecretPanel";

export interface RotateSecretDialogProps {
  source: TelemetrySource;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Rotate a webhook-mode source's endpoint secret. The previous secret stops
 * verifying immediately; the new one is revealed once (same shown-once panel as
 * create). Gated on the source's manage verdict.
 */
export function RotateSecretDialog({
  source,
  open,
  onOpenChange,
}: RotateSecretDialogProps) {
  const client = usePluginClient(TelemetryApi);
  const toast = useToast();
  const [webhook, dispatchWebhook] = useReducer(
    webhookPanelReducer,
    initialWebhookPanelState,
  );

  const rotateMutation = client.rotateWebhookSecret.useGatedMutation({
    gateInput: { id: source.id },
    onSuccess: (info) => {
      dispatchWebhook({ type: "reveal", info });
      toast.success("Webhook secret rotated");
    },
    onError: (error) => toastError(toast, "Failed to rotate secret", error),
  });

  useEffect(() => {
    if (open) dispatchWebhook({ type: "dismiss" });
  }, [open]);

  const revealed = isWebhookPanelOpen(webhook);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="default">
        <DialogHeader>
          <DialogTitle>
            {revealed ? "New webhook secret" : "Rotate webhook secret"}
          </DialogTitle>
          <DialogDescription>
            {revealed
              ? "Update the sender with this secret. It is shown once."
              : `Rotating immediately invalidates the current secret for ${source.name}. Any sender using it will stop being accepted until updated.`}
          </DialogDescription>
        </DialogHeader>

        {revealed && webhook.info ? (
          <div className="space-y-4">
            <WebhookSecretPanel info={webhook.info} />
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={rotateMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => rotateMutation.mutate({ id: source.id })}
              disabled={rotateMutation.isPending}
            >
              {rotateMutation.isPending ? "Rotating..." : "Rotate secret"}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
