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
  TeamOwnershipPicker,
  TeamAccessEditor,
  teamCreateErrorMessage,
} from "@checkstack/auth-frontend";
import { useApi, accessApiRef } from "@checkstack/frontend-api";
import { catalogAccess, catalogResourceTypes } from "@checkstack/catalog-common";

interface GroupEditorProps {
  open: boolean;
  onClose: () => void;
  onSave: (data: { name: string; teamId?: string }) => Promise<void>;
  initialData?: { id: string; name: string };
}

export const GroupEditor: React.FC<GroupEditorProps> = ({
  open,
  onClose,
  onSave,
  initialData,
}) => {
  const [name, setName] = useState(initialData?.name || "");
  const [ownerTeamId, setOwnerTeamId] = useState<string | null>(null);
  const [ownerTeamError, setOwnerTeamError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const toast = useToast();

  // Global manage holders may create a team-less (global) group; team-scoped
  // creators must pick an owning team (the picker marks it required for them).
  const accessApi = useApi(accessApiRef);
  const { allowed: allowGlobal } = accessApi.useAccess(
    catalogAccess.group.manage,
  );

  // Seed the form ONCE per open transition. The parent rebuilds `initialData`
  // each render and realtime invalidations refetch while open, so a
  // `useEffect([open, initialData])` would re-seed on refetch and wipe edits.
  useSeedFormOnOpen(open, () => {
    setName(initialData?.name || "");
    setOwnerTeamId(null);
    setOwnerTeamError(null);
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setLoading(true);
    setOwnerTeamError(null);
    try {
      await onSave({
        name: name.trim(),
        ...(initialData ? {} : { teamId: ownerTeamId ?? undefined }),
      });
      onClose();
    } catch (error) {
      const inline = teamCreateErrorMessage(error);
      if (inline) {
        setOwnerTeamError(inline);
      } else {
        toastError(toast, "Failed to save group", error);
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
              {initialData ? "Edit Group" : "Create Group"}
            </DialogTitle>
            <DialogDescription className="sr-only">
              {initialData
                ? "Modify the settings for this group"
                : "Create a new group to organize your systems"}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="group-name">Name</Label>
              <Input
                id="group-name"
                placeholder="e.g. Payment Flow"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>

            {/* Owning team picker - only when creating a new group. */}
            {!initialData && (
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
                group (needs its id). Groups have no detail page, so this is the
                home for adding/removing multiple teams and toggling privacy,
                mirroring how systems manage it on their detail page. It writes
                immediately, independent of this form's deferred Save. */}
            {initialData?.id && (
              <TeamAccessEditor
                resourceType={catalogResourceTypes.group}
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
                : initialData
                ? "Save Changes"
                : "Create Group"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
