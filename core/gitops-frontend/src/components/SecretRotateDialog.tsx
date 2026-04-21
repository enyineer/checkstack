import React, { useState, useEffect } from "react";
import {
  Button,
  Input,
  Label,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@checkstack/ui";

interface SecretRotateDialogProps {
  open: boolean;
  secretName: string;
  onClose: () => void;
  onSave: (value: string) => void;
}

export const SecretRotateDialog: React.FC<SecretRotateDialogProps> = ({
  open,
  secretName,
  onClose,
  onSave,
}) => {
  const [value, setValue] = useState("");

  useEffect(() => {
    if (open) {
      setValue("");
    }
  }, [open]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!value.trim()) return;
    onSave(value.trim());
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent size="default">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Rotate Secret</DialogTitle>
            <DialogDescription>
              Enter a new value for <code className="font-mono text-sm">{secretName}</code>.
              The old value will be permanently replaced.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="rotate-value">New Value</Label>
              <Input
                id="rotate-value"
                type="password"
                placeholder="New secret value..."
                value={value}
                onChange={(e) => setValue(e.target.value)}
                required
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!value.trim()}>
              Rotate Secret
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
