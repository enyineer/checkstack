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
  Alert,
  AlertContent,
  AlertDescription,
  AlertIcon,
  AlertTitle,
  useToast,
  toastError,
  useSeedFormOnOpen,
} from "@checkstack/ui";
import {
  TeamOwnershipPicker,
  TeamAccessEditor,
  teamCreateErrorMessage,
} from "@checkstack/auth-frontend";
import { useApi, accessApiRef } from "@checkstack/frontend-api";
import { buildClonedName } from "@checkstack/common";
import { catalogAccess, catalogResourceTypes } from "@checkstack/catalog-common";
import {
  CLONE_SCOPE_NOTE,
  isCreateMode,
  resolveEditorMode,
  type CatalogEditorMode,
} from "./catalog-clone.logic";
import {
  metadataToRows,
  rowsToMetadata,
  hasDuplicateKeys,
  type CustomFieldRow,
} from "./environment-fields.logic";
import { Copy } from "lucide-react";
import { CustomFieldsEditor } from "./CustomFieldsEditor";

export interface EnvironmentEditorInitialData {
  id: string;
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
    teamId?: string;
    metadata?: Record<string, string>;
  }) => Promise<void>;
  /**
   * The environment being edited, or - in `clone` mode - the one the new
   * environment is seeded from.
   */
  initialData?: EnvironmentEditorInitialData;
  /** Defaults to `edit` when `initialData` is present, else `create`. */
  mode?: CatalogEditorMode;
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
  mode,
}) => {
  const editorMode = resolveEditorMode({
    mode,
    hasInitialData: Boolean(initialData),
  });
  const isCloning = editorMode === "clone";
  const creating = isCreateMode({ mode: editorMode });
  // A clone opens with a suffixed name so it cannot be confused with - or saved
  // over - the environment it was copied from.
  const seededName = initialData
    ? isCloning
      ? buildClonedName({ name: initialData.name })
      : initialData.name
    : "";

  const [name, setName] = useState(seededName);
  const [description, setDescription] = useState(
    initialData?.description ?? "",
  );
  const [fields, setFields] = useState<CustomFieldRow[]>(() =>
    metadataToRows(initialData?.metadata),
  );
  const [ownerTeamId, setOwnerTeamId] = useState<string | null>(null);
  const [ownerTeamError, setOwnerTeamError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const toast = useToast();

  // Global manage holders may create a team-less (global) environment;
  // team-scoped creators must pick an owning team.
  const accessApi = useApi(accessApiRef);
  const { allowed: allowGlobal } = accessApi.useAccess(
    catalogAccess.environment.manage,
  );

  // Seed the form ONCE per open transition. The parent passes `initialData` as
  // a fresh object literal each render and realtime invalidations refetch the
  // environment while open, so a `useEffect([open, initialData])` would re-seed
  // on refetch and wipe in-progress edits.
  useSeedFormOnOpen(open, () => {
    setName(seededName);
    setDescription(initialData?.description ?? "");
    setFields(metadataToRows(initialData?.metadata));
    setOwnerTeamId(null);
    setOwnerTeamError(null);
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    if (hasDuplicateKeys(fields)) {
      toast.error("Custom field keys must be unique");
      return;
    }

    setLoading(true);
    setOwnerTeamError(null);
    try {
      await onSave({
        name: name.trim(),
        description: description.trim() || undefined,
        metadata: rowsToMetadata(fields),
        // A clone saves through the CREATE path, so it must carry the owning
        // team like any other new environment - not be treated as an update.
        ...(creating ? { teamId: ownerTeamId ?? undefined } : {}),
      });
      onClose();
    } catch (error) {
      const inline = teamCreateErrorMessage(error);
      if (inline) {
        setOwnerTeamError(inline);
      } else {
        toastError(toast, "Failed to save environment", error);
      }
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
              {editorMode === "edit"
                ? "Edit Environment"
                : isCloning
                  ? "Clone Environment"
                  : "Create Environment"}
            </DialogTitle>
            <DialogDescription className="sr-only">
              {editorMode === "edit"
                ? "Modify this environment and its custom fields"
                : isCloning
                  ? "Create a new environment starting from an existing environment's custom fields"
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

            {/* Clone scope - states plainly what did NOT come along, so nobody
                assumes the copy inherited the source's team access. */}
            {isCloning && initialData && (
              <Alert variant="info">
                <AlertIcon>
                  <Copy className="h-4 w-4" />
                </AlertIcon>
                <AlertContent>
                  <AlertTitle>Cloned from {initialData.name}</AlertTitle>
                  <AlertDescription>{CLONE_SCOPE_NOTE}</AlertDescription>
                </AlertContent>
              </Alert>
            )}

            {/* Owning team picker - shown for every create, clones included. */}
            {creating && (
              <div className="space-y-2">
                <TeamOwnershipPicker
                  value={ownerTeamId}
                  onChange={(id) => {
                    setOwnerTeamId(id);
                    setOwnerTeamError(null);
                  }}
                  allowGlobal={allowGlobal}
                  error={ownerTeamError}
                />
              </div>
            )}

            {/* Full team-access management - only when editing an existing
                environment (needs its id). Environments have no detail page, so
                this is the home for adding/removing multiple teams and toggling
                privacy, mirroring how systems manage it on their detail page. It
                writes immediately, independent of this form's deferred Save. */}
            {editorMode === "edit" && initialData?.id && (
              <TeamAccessEditor
                resourceType={catalogResourceTypes.environment}
                resourceId={initialData.id}
                compact
                expanded
              />
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading || !name.trim()}>
              {loading
                ? "Saving..."
                : editorMode === "edit"
                  ? "Save Changes"
                  : "Create Environment"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
