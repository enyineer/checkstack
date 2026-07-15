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
  FormError,
  useToast,
  toastError,
  useSeedFormOnOpen,
} from "@checkstack/ui";
import {
  TelemetryApi,
  type SourceTypeDescriptor,
  type TelemetrySource,
} from "@checkstack/telemetry-common";
import {
  buildUpdatePayload,
  deriveInitialInterval,
  type SourceEditorValues,
} from "../lib/source-form.logic";
import {
  bindingsToArray,
  initialBindingSelection,
} from "../lib/binding-editor.logic";
import { BindingEditor } from "./BindingEditor";
import { SourceConfigFields } from "./SourceConfigFields";

export interface EditSourceDialogProps {
  descriptor: SourceTypeDescriptor;
  source: TelemetrySource;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function valuesFromSource({
  descriptor,
  source,
}: {
  descriptor: SourceTypeDescriptor;
  source: TelemetrySource;
}): SourceEditorValues {
  return {
    name: source.name,
    description: source.description ?? "",
    // Secret fields read back omitted; DynamicForm's keep-existing semantics
    // (fed `storedSecretFields`) treat a blank secret input as "keep".
    config: { ...source.config },
    intervalSeconds: deriveInitialInterval({ descriptor, source }),
    satelliteId: source.satelliteId,
    bindings: initialBindingSelection({ descriptor, source }),
  };
}

/**
 * Edit an existing source. The form is pre-filled; secret config fields read
 * back omitted and are marked keep-existing via `storedSecretFields`, so a
 * blank secret input keeps the stored value. Stream bindings are editable per
 * signal (a bound-but-no-longer-listable stream stays visible). The source type
 * itself is immutable (delete and recreate to change it).
 */
export function EditSourceDialog({
  descriptor,
  source,
  open,
  onOpenChange,
}: EditSourceDialogProps) {
  const client = usePluginClient(TelemetryApi);
  const toast = useToast();

  const [values, setValues] = useState<SourceEditorValues>(() =>
    valuesFromSource({ descriptor, source }),
  );
  const [formError, setFormError] = useState<string | null>(null);

  // Reseed once when the dialog opens for this source; a background
  // react-query refetch of `source` while the dialog is open must not wipe
  // the user's in-progress edits.
  useSeedFormOnOpen(open, () => {
    setValues(valuesFromSource({ descriptor, source }));
    setFormError(null);
  });

  const updateMutation = client.updateSource.useGatedMutation({
    gateInput: { id: source.id },
    onSuccess: () => {
      toast.success("Source updated");
      onOpenChange(false);
    },
    onError: (error) => toastError(toast, "Failed to update source", error),
  });

  const patchValues = (patch: Partial<SourceEditorValues>) =>
    setValues((prev) => ({ ...prev, ...patch }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (values.name.trim().length === 0) {
      setFormError("Name is required");
      return;
    }
    if (bindingsToArray({ descriptor, selection: values.bindings }).length === 0) {
      setFormError("Route at least one signal to a stream");
      return;
    }
    setFormError(null);
    updateMutation.mutate({
      id: source.id,
      body: buildUpdatePayload({ descriptor, values, source }),
    });
  };

  const saving = updateMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Edit {source.name}</DialogTitle>
          <DialogDescription>
            Update this {descriptor.displayName} source. Leave secret fields
            blank to keep their stored values.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <SourceConfigFields
            descriptor={descriptor}
            values={values}
            onChange={patchValues}
            keepExistingSecretFields={source.storedSecretFields}
            sourceId={source.id}
            disabled={saving}
          />

          <BindingEditor
            descriptor={descriptor}
            selection={values.bindings}
            onChange={(bindings) => patchValues({ bindings })}
            bindingStreamNames={source.bindingStreamNames}
            disabled={saving}
          />

          {formError && <FormError>{formError}</FormError>}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving..." : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
