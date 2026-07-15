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
  type SourceTypeDescriptor,
  type TelemetrySource,
} from "@checkstack/telemetry-common";
import { isPushType } from "../lib/source-form.logic";
import {
  initialSecretRevealState,
  isSecretRevealOpen,
  secretRevealReducer,
} from "../lib/secret-reveal.logic";
import { WebhookSecretPanel } from "./WebhookSecretPanel";
import { PushSecretPanel } from "./PushSecretPanel";

export interface RotateSecretDialogProps {
  source: TelemetrySource;
  descriptor: SourceTypeDescriptor;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Rotate a push- or webhook-mode source's ingest secret. The previous secret
 * stops being accepted immediately; the new one is revealed once (same
 * shown-once panel as create). Which secret rotates is decided by the type's
 * mode. Gated on the source's manage verdict.
 */
export function RotateSecretDialog({
  source,
  descriptor,
  open,
  onOpenChange,
}: RotateSecretDialogProps) {
  const client = usePluginClient(TelemetryApi);
  const toast = useToast();
  const [reveal, dispatchReveal] = useReducer(
    secretRevealReducer,
    initialSecretRevealState,
  );

  const push = isPushType(descriptor);
  const noun = push ? "token" : "secret";

  const rotateWebhook = client.rotateWebhookSecret.useGatedMutation({
    gateInput: { id: source.id },
    onSuccess: (info) => {
      dispatchReveal({ type: "reveal", reveal: { kind: "webhook", info } });
      toast.success("Webhook secret rotated");
    },
    onError: (error) => toastError(toast, "Failed to rotate secret", error),
  });

  const rotatePush = client.rotatePushToken.useGatedMutation({
    gateInput: { id: source.id },
    onSuccess: (info) => {
      dispatchReveal({ type: "reveal", reveal: { kind: "push", info } });
      toast.success("Source token rotated");
    },
    onError: (error) => toastError(toast, "Failed to rotate token", error),
  });

  const rotating = push ? rotatePush.isPending : rotateWebhook.isPending;

  useEffect(() => {
    if (open) dispatchReveal({ type: "dismiss" });
  }, [open]);

  const rotate = () => {
    if (push) rotatePush.mutate({ id: source.id });
    else rotateWebhook.mutate({ id: source.id });
  };

  const revealed = isSecretRevealOpen(reveal);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size={revealed && push ? "lg" : "default"}>
        <DialogHeader>
          <DialogTitle>
            {revealed
              ? push
                ? "New source token"
                : "New webhook secret"
              : push
                ? "Rotate source token"
                : "Rotate webhook secret"}
          </DialogTitle>
          <DialogDescription>
            {revealed
              ? `Update the sender with this ${noun}. It is shown once.`
              : `Rotating immediately invalidates the current ${noun} for ${source.name}. Any sender using it will stop being accepted until updated.`}
          </DialogDescription>
        </DialogHeader>

        {revealed && reveal.reveal ? (
          <div className="space-y-4">
            {reveal.reveal.kind === "webhook" ? (
              <WebhookSecretPanel info={reveal.reveal.info} />
            ) : (
              <PushSecretPanel
                info={reveal.reveal.info}
                signals={descriptor.signals}
              />
            )}
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
              disabled={rotating}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={rotate}
              disabled={rotating}
            >
              {rotating ? "Rotating..." : `Rotate ${noun}`}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
