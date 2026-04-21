import React, { useState, useEffect } from "react";
import {
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@checkstack/ui";

interface ProviderEditorProps {
  open: boolean;
  onClose: () => void;
  onSave: (data: {
    type: "github" | "gitlab";
    target: string;
    pathPattern: string;
    baseUrl?: string;
    authToken?: string;
    syncInterval?: number;
    deletionPolicy?: "orphan" | "auto";
  }) => void;
  initialData?: {
    id: string;
    type: "github" | "gitlab";
    target: string;
    pathPattern: string;
    baseUrl?: string;
    syncInterval: number;
    deletionPolicy: "orphan" | "auto";
  };
}

export const ProviderEditor: React.FC<ProviderEditorProps> = ({
  open,
  onClose,
  onSave,
  initialData,
}) => {
  const [type, setType] = useState<"github" | "gitlab">(initialData?.type ?? "github");
  const [target, setTarget] = useState(initialData?.target ?? "");
  const [pathPattern, setPathPattern] = useState(initialData?.pathPattern ?? ".checkstack/**/*.yaml");
  const [baseUrl, setBaseUrl] = useState(initialData?.baseUrl ?? "");
  const [authToken, setAuthToken] = useState("");
  const [syncInterval, setSyncInterval] = useState(String(initialData?.syncInterval ?? 300));
  const [deletionPolicy, setDeletionPolicy] = useState<"orphan" | "auto">(
    initialData?.deletionPolicy ?? "orphan",
  );

  useEffect(() => {
    if (open) {
      setType(initialData?.type ?? "github");
      setTarget(initialData?.target ?? "");
      setPathPattern(initialData?.pathPattern ?? ".checkstack/**/*.yaml");
      setBaseUrl(initialData?.baseUrl ?? "");
      setAuthToken("");
      setSyncInterval(String(initialData?.syncInterval ?? 300));
      setDeletionPolicy(initialData?.deletionPolicy ?? "orphan");
    }
  }, [open, initialData]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!target.trim() || !pathPattern.trim()) return;

    onSave({
      type,
      target: target.trim(),
      pathPattern: pathPattern.trim(),
      baseUrl: baseUrl.trim() || undefined,
      authToken: authToken.trim() || undefined,
      syncInterval: Number(syncInterval) || 300,
      deletionPolicy,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent size="default">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>
              {initialData ? "Edit Provider" : "Add Provider"}
            </DialogTitle>
            <DialogDescription className="sr-only">
              {initialData
                ? "Modify the settings for this Git provider"
                : "Configure a new Git provider for GitOps syncing"}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="provider-type">Provider Type</Label>
              <Select
                value={type}
                onValueChange={(v) => setType(v as "github" | "gitlab")}
                disabled={!!initialData}
              >
                <SelectTrigger id="provider-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="github">GitHub</SelectItem>
                  <SelectItem value="gitlab">GitLab</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="provider-target">Target</Label>
              <Input
                id="provider-target"
                placeholder="e.g. my-org or my-org/my-repo"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                required
              />
              <p className="text-xs text-muted-foreground">
                Organization name for org-wide scanning, or owner/repo for a single repository.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="provider-path">Path Pattern</Label>
              <Input
                id="provider-path"
                placeholder=".checkstack/**/*.yaml"
                value={pathPattern}
                onChange={(e) => setPathPattern(e.target.value)}
                required
              />
              <p className="text-xs text-muted-foreground">
                Glob pattern for matching descriptor files in repositories.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="provider-base-url">Base URL (optional)</Label>
              <Input
                id="provider-base-url"
                placeholder="https://github.example.com/api/v3"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                For GitHub Enterprise or self-hosted GitLab instances.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="provider-auth-token">
                Auth Token {initialData ? "(leave empty to keep current)" : "(optional)"}
              </Label>
              <Input
                id="provider-auth-token"
                type="password"
                placeholder="ghp_xxxx..."
                value={authToken}
                onChange={(e) => setAuthToken(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="provider-interval">Sync Interval (seconds)</Label>
                <Input
                  id="provider-interval"
                  type="number"
                  min={60}
                  value={syncInterval}
                  onChange={(e) => setSyncInterval(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="provider-deletion">Deletion Policy</Label>
                <Select
                  value={deletionPolicy}
                  onValueChange={(v) => setDeletionPolicy(v as "orphan" | "auto")}
                >
                  <SelectTrigger id="provider-deletion">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="orphan">Orphan (manual review)</SelectItem>
                    <SelectItem value="auto">Auto-delete</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!target.trim() || !pathPattern.trim()}>
              {initialData ? "Save Changes" : "Add Provider"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
