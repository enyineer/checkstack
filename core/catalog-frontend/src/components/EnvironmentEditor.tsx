import React, { useState } from "react";
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
  useToast,
  toastError,
  useSeedFormOnOpen,
} from "@checkstack/ui";
import {
  metadataToRows,
  rowsToMetadata,
  hasDuplicateKeys,
  type CustomFieldRow,
} from "./environment-fields.logic";
import { CustomFieldsEditor } from "./CustomFieldsEditor";

export interface EnvironmentEditorInitialData {
  name: string;
  description?: string;
  metadata?: Record<string, unknown> | null;
}

interface EnvironmentEditorProps {
  open: boolean;
  onClose: () => void;
  onSave: (data: {
    name: string;
    description?: string;
    metadata?: Record<string, string>;
  }) => Promise<void>;
  initialData?: EnvironmentEditorInitialData;
}

/**
 * Create/edit dialog for an instance-wide environment. Mirrors
 * {@link GroupEditor} for name/description and adds a free-form key/value
 * custom-fields editor (v1 metadata is free-form; the pure row<->record
 * conversion lives in `environment-fields.logic.ts`).
 */
export const EnvironmentEditor: React.FC<EnvironmentEditorProps> = ({
  open,
  onClose,
  onSave,
  initialData,
}) => {
  const [name, setName] = useState(initialData?.name ?? "");
  const [description, setDescription] = useState(
    initialData?.description ?? "",
  );
  const [fields, setFields] = useState<CustomFieldRow[]>(() =>
    metadataToRows(initialData?.metadata),
  );
  const [loading, setLoading] = useState(false);
  const toast = useToast();

  // Seed the form ONCE per open transition. The parent passes `initialData` as
  // a fresh object literal each render and realtime invalidations refetch the
  // environment while open, so a `useEffect([open, initialData])` would re-seed
  // on refetch and wipe in-progress edits.
  useSeedFormOnOpen(open, () => {
    setName(initialData?.name ?? "");
    setDescription(initialData?.description ?? "");
    setFields(metadataToRows(initialData?.metadata));
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    if (hasDuplicateKeys(fields)) {
      toast.error("Custom field keys must be unique");
      return;
    }

    setLoading(true);
    try {
      await onSave({
        name: name.trim(),
        description: description.trim() || undefined,
        metadata: rowsToMetadata(fields),
      });
      onClose();
    } catch (error) {
      toastError(toast, "Failed to save environment", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent size="default">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>
              {initialData ? "Edit Environment" : "Create Environment"}
            </DialogTitle>
            <DialogDescription className="sr-only">
              {initialData
                ? "Modify this environment and its custom fields"
                : "Create a new environment with custom fields"}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="environment-name">Name</Label>
              <Input
                id="environment-name"
                placeholder="e.g. Production"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="environment-description">
                Description (optional)
              </Label>
              <Input
                id="environment-description"
                placeholder="e.g. Live production traffic"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            <CustomFieldsEditor
              fields={fields}
              onChange={setFields}
              description="Free-form key/value pairs (baseUrl, region, tier, ...). These surface to checks assigned to systems in this environment."
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading || !name.trim()}>
              {loading
                ? "Saving..."
                : initialData
                  ? "Save Changes"
                  : "Create Environment"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
