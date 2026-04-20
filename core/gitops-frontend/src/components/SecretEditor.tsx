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

interface SecretEditorProps {
  open: boolean;
  onClose: () => void;
  onSave: (data: { name: string; value: string; description?: string }) => void;
}

export const SecretEditor: React.FC<SecretEditorProps> = ({
  open,
  onClose,
  onSave,
}) => {
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (open) {
      setName("");
      setValue("");
      setDescription("");
    }
  }, [open]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !value.trim()) return;

    onSave({
      name: name.trim(),
      value: value.trim(),
      description: description.trim() || undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent size="default">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Create Secret</DialogTitle>
            <DialogDescription className="sr-only">
              Create a new secret for use in GitOps YAML descriptors
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="secret-name">Name</Label>
              <Input
                id="secret-name"
                placeholder="e.g. GITHUB_TOKEN"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="font-mono"
                required
              />
              <p className="text-xs text-muted-foreground">
                Referenced as <code className="text-xs">{"${{ secrets.NAME }}"}</code> in descriptors.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="secret-value">Value</Label>
              <Input
                id="secret-value"
                type="password"
                placeholder="Secret value..."
                value={value}
                onChange={(e) => setValue(e.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="secret-description">Description (optional)</Label>
              <Input
                id="secret-description"
                placeholder="What this secret is used for..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || !value.trim()}>
              Create Secret
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
