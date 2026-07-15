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
import { Layers } from "lucide-react";
import { Link } from "react-router-dom";
import {
  TeamOwnershipPicker,
  teamCreateErrorMessage,
} from "@checkstack/auth-frontend";
import { useApi, accessApiRef } from "@checkstack/frontend-api";
import { resolveRoute } from "@checkstack/common";
import { catalogAccess, catalogRoutes } from "@checkstack/catalog-common";
import {
  metadataToRows,
  rowsToMetadata,
  hasDuplicateKeys,
  type CustomFieldRow,
} from "./environment-fields.logic";
import { CustomFieldsEditor } from "./CustomFieldsEditor";

interface SystemEditorProps {
  open: boolean;
  onClose: () => void;
  onSave: (data: {
    name: string;
    description?: string;
    teamId?: string;
    metadata?: Record<string, string>;
  }) => Promise<void>;
  initialData?: {
    id: string;
    name: string;
    description?: string;
    metadata?: Record<string, unknown> | null;
  };
}

export const SystemEditor: React.FC<SystemEditorProps> = ({
  open,
  onClose,
  onSave,
  initialData,
}) => {
  const [name, setName] = useState(initialData?.name || "");
  const [description, setDescription] = useState(
    initialData?.description || "",
  );
  const [ownerTeamId, setOwnerTeamId] = useState<string | null>(null);
  const [ownerTeamError, setOwnerTeamError] = useState<string | null>(null);
  const [fields, setFields] = useState<CustomFieldRow[]>(() =>
    metadataToRows(initialData?.metadata),
  );
  const [loading, setLoading] = useState(false);
  const toast = useToast();

  const accessApi = useApi(accessApiRef);
  const { allowed: allowGlobal } = accessApi.useAccess(catalogAccess.system.manage);

  // Seed the form ONCE per open transition, not on every `initialData` change.
  // The parent rebuilds `initialData` as a fresh object literal on every
  // render, and realtime catalog invalidations refetch the underlying system
  // while this dialog is open - a naive `useEffect([open, initialData])` would
  // re-seed on those refetches and wipe the user's in-progress edits.
  useSeedFormOnOpen(open, () => {
    setName(initialData?.name || "");
    setDescription(initialData?.description || "");
    setOwnerTeamId(null);
    setOwnerTeamError(null);
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
    setOwnerTeamError(null);
    try {
      await onSave({
        name: name.trim(),
        description: description.trim() || undefined,
        metadata: rowsToMetadata(fields),
        ...(initialData?.id ? {} : { teamId: ownerTeamId ?? undefined }),
      });
      onClose();
    } catch (error) {
      const inline = teamCreateErrorMessage(error);
      if (inline) {
        setOwnerTeamError(inline);
      } else {
        toastError(toast, "Failed to save system", error);
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
              {initialData ? "Edit System" : "Create System"}
            </DialogTitle>
            <DialogDescription className="sr-only">
              {initialData
                ? "Modify the settings for this system"
                : "Create a new system to monitor"}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="system-name">Name</Label>
              <Input
                id="system-name"
                placeholder="e.g. Payments API"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="system-description">Description (optional)</Label>
              <textarea
                id="system-description"
                className="w-full flex min-h-[80px] rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-none"
                placeholder="Describe what this system does..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
              />
            </div>

            <CustomFieldsEditor
              fields={fields}
              onChange={setFields}
              description={
                <>
                  Free-form key/value pairs. Each key surfaces to health-check
                  config templates as{" "}
                  <code>{"{{ system.metadata.<key> }}"}</code> (for example a
                  per-system {"{{ system.metadata.baseUrl }}"}).
                </>
              }
            />

            {/* Modelling hint - only when creating a new system. Steers new
                users away from "one system per environment", which is the most
                common onboarding mistake. */}
            {!initialData?.id && (
              <Alert variant="info">
                <AlertIcon>
                  <Layers className="h-4 w-4" />
                </AlertIcon>
                <AlertContent>
                  <AlertTitle>One system, many environments</AlertTitle>
                  <AlertDescription>
                    A system usually pairs with a single health check. To monitor
                    it across dev, staging, and prod, do not create a system per
                    stage - create it once, then attach Environments after saving
                    and one check runs once per environment.
                  </AlertDescription>
                </AlertContent>
              </Alert>
            )}

            {/* Owning team picker - only shown when creating a new system */}
            {!initialData?.id && (
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

            {/* The living data (contacts, links, dependencies, team access,
                environment membership) is managed on the system's detail page,
                not in this deferred-save identity form. */}
            {initialData?.id && (
              <p className="text-xs text-muted-foreground">
                Contacts, links, dependencies and team access are managed on the{" "}
                <Link
                  to={resolveRoute(catalogRoutes.routes.systemDetail, {
                    systemId: initialData.id,
                  })}
                  onClick={onClose}
                  className="text-primary hover:underline"
                >
                  system page
                </Link>
                .
              </p>
            )}
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
                  : "Create System"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
