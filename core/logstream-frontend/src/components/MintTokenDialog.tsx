import { useState } from "react";
import { usePluginClient } from "@checkstack/frontend-api";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  Button,
  Input,
  Label,
  FormError,
  CopyableValue,
  useToast,
  toastError,
} from "@checkstack/ui";
import { LogstreamApi } from "@checkstack/logstream-common";

export interface MintTokenDialogProps {
  streamId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the full secret once, so the parent can offer it to the setup snippets. */
  onMinted?: (secret: string) => void;
}

/**
 * Mint a source token. The full secret is shown exactly once (the backend keeps
 * only its hash), guarded by `CopyableValue`'s shown-once warning.
 */
export function MintTokenDialog({
  streamId,
  open,
  onOpenChange,
  onMinted,
}: MintTokenDialogProps) {
  const client = usePluginClient(LogstreamApi);
  const toast = useToast();
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);

  const mintMutation = client.mintToken.useGatedMutation({
    gateInput: { streamId },
    onSuccess: (result) => {
      setSecret(result.secret);
      onMinted?.(result.secret);
    },
    onError: (error) => toastError(toast, "Failed to mint token", error),
  });

  const reset = () => {
    setName("");
    setNameError(null);
    setSecret(null);
  };

  const handleClose = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      setNameError("Name is required");
      return;
    }
    setNameError(null);
    mintMutation.mutate({ streamId, name: trimmed });
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent size="default">
        <DialogHeader>
          <DialogTitle>
            {secret ? "Token created" : "Mint source token"}
          </DialogTitle>
          <DialogDescription>
            {secret
              ? "Copy this token now. It grants ingest access to this stream and cannot be shown again."
              : "A source token authenticates a shipper to push logs into this stream."}
          </DialogDescription>
        </DialogHeader>

        {secret ? (
          <div className="space-y-4">
            <CopyableValue
              value={secret}
              label="Source token"
              shownOnce
              warningMessage="Store this token securely. It will not be shown again."
            />
            <DialogFooter>
              <Button onClick={() => handleClose(false)}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="token-name">Name</Label>
              <Input
                id="token-name"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (nameError) setNameError(null);
                }}
                placeholder="prod-collector"
                autoFocus
                maxLength={255}
              />
              {nameError && <FormError>{nameError}</FormError>}
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => handleClose(false)}
                disabled={mintMutation.isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={mintMutation.isPending}>
                {mintMutation.isPending ? "Minting..." : "Mint token"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
