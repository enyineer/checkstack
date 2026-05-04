import { usePluginClient, useApi, accessApiRef } from "@checkstack/frontend-api";
import { GitOpsApi, gitopsAccess } from "@checkstack/gitops-common";
import type { Provenance } from "@checkstack/gitops-common";
import {
  Card,
  CardHeader,
  CardHeaderRow,
  CardTitle,
  CardContent,
  Button,
  Badge,
  EmptyState,
  ConfirmationModal,
  useToast,
} from "@checkstack/ui";
import { useState } from "react";
import { CheckCircle, AlertTriangle, XCircle, Trash2, X } from "lucide-react";
import { extractErrorMessage } from "@checkstack/common";

export const ProvenanceStatus = () => {
  const client = usePluginClient(GitOpsApi);
  const accessApi = useApi(accessApiRef);
  const toast = useToast();

  const { allowed: canManage } = accessApi.useAccess(gitopsAccess.provider.manage);

  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    provenanceId: string;
    entityName: string;
  }>({ isOpen: false, provenanceId: "", entityName: "" });

  const {
    data: provenanceEntries,
    isLoading,
    refetch,
  } = client.listProvenance.useQuery({});

  const confirmDeleteMutation = client.confirmOrphanDeletion.useMutation({
    onSuccess: () => {
      toast.success("Orphan deleted successfully");
      setConfirmModal({ isOpen: false, provenanceId: "", entityName: "" });
      void refetch();
    },
    onError: (error) => {
      toast.error(extractErrorMessage(error, "Failed to delete orphan"));
    },
  });

  const dismissMutation = client.dismissOrphan.useMutation({
    onSuccess: () => {
      toast.success("Orphan dismissed — entity is no longer tracked by GitOps");
      void refetch();
    },
    onError: (error) => {
      toast.error(extractErrorMessage(error, "Failed to dismiss orphan"));
    },
  });

  const entries = provenanceEntries ?? [];
  const synced = entries.filter((e) => e.status === "synced");
  const errors = entries.filter((e) => e.status === "error");
  const orphaned = entries.filter((e) => e.status === "orphaned");
  const withWarnings = entries.filter(
    (e) => e.warnings.length > 0 && e.status === "synced",
  );

  const statusIcon = (status: Provenance["status"]) => {
    switch (status) {
      case "synced": {
        return <CheckCircle className="w-4 h-4 text-emerald-500" />;
      }
      case "error": {
        return <XCircle className="w-4 h-4 text-destructive" />;
      }
      case "orphaned": {
        return <AlertTriangle className="w-4 h-4 text-amber-500" />;
      }
    }
  };

  const statusBadge = (status: Provenance["status"]) => {
    const variants: Record<Provenance["status"], "default" | "destructive" | "outline"> = {
      synced: "default",
      error: "destructive",
      orphaned: "outline",
    };
    return <Badge variant={variants[status]}>{status}</Badge>;
  };

  const renderEntryList = (list: Provenance[], showOrphanActions: boolean) => (
    <div className="space-y-2">
      {list.map((entry) => (
        <div
          key={entry.id}
          className="flex items-center justify-between p-3 rounded-lg border border-border bg-background/50"
        >
          <div className="flex items-center gap-3 min-w-0">
            {statusIcon(entry.status)}
            <div className="min-w-0">
              <div className="text-sm font-medium">
                <span className="text-muted-foreground">{entry.kind}/</span>
                {entry.entityName}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5 truncate">
                {entry.repository}/{entry.filePath}
              </div>
              {entry.errorMessage && (
                <div className="text-xs text-destructive mt-0.5 truncate">
                  {entry.errorMessage}
                </div>
              )}
              {entry.warnings.length > 0 && (
                <div className="mt-1 space-y-0.5">
                  {entry.warnings.map((warning, index) => (
                    <div
                      key={index}
                      className="text-xs text-amber-500 flex items-start gap-1"
                    >
                      <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
                      <span className="truncate">{warning}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {statusBadge(entry.status)}
            {showOrphanActions && canManage && (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() =>
                    setConfirmModal({
                      isOpen: true,
                      provenanceId: entry.id,
                      entityName: `${entry.kind}/${entry.entityName}`,
                    })
                  }
                  title="Confirm deletion"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => dismissMutation.mutate({ provenanceId: entry.id })}
                  title="Dismiss orphan"
                >
                  <X className="w-4 h-4" />
                </Button>
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <>
      <div className="space-y-6">
        {/* Summary */}
        <div className="grid grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-emerald-500" />
                <span className="text-2xl font-bold">{synced.length}</span>
                <span className="text-sm text-muted-foreground">Synced</span>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2">
                <XCircle className="w-5 h-5 text-destructive" />
                <span className="text-2xl font-bold">{errors.length}</span>
                <span className="text-sm text-muted-foreground">Errors</span>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-amber-500" />
                <span className="text-2xl font-bold">{orphaned.length}</span>
                <span className="text-sm text-muted-foreground">Orphaned</span>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-amber-500" />
                <span className="text-2xl font-bold">{withWarnings.length}</span>
                <span className="text-sm text-muted-foreground">Warnings</span>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Orphaned entities — shown first if any */}
        {orphaned.length > 0 && (
          <Card>
            <CardHeader>
              <CardHeaderRow>
                <CardTitle className="flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-amber-500" />
                  Orphaned Entities
                </CardTitle>
              </CardHeaderRow>
              <p className="text-xs text-muted-foreground mt-1">
                These entities were removed from Git. Confirm deletion or dismiss to keep the entity.
              </p>
            </CardHeader>
            <CardContent>{renderEntryList(orphaned, true)}</CardContent>
          </Card>
        )}

        {/* Warnings */}
        {withWarnings.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-amber-500" />
                Sync Warnings
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                These entities contain secret templates in non-secret fields. The templates will not be resolved.
              </p>
            </CardHeader>
            <CardContent>{renderEntryList(withWarnings, false)}</CardContent>
          </Card>
        )}

        {/* Errors */}
        {errors.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <XCircle className="w-5 h-5 text-destructive" />
                Sync Errors
              </CardTitle>
            </CardHeader>
            <CardContent>{renderEntryList(errors, false)}</CardContent>
          </Card>
        )}

        {/* Synced entities */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-emerald-500" />
              Synced Entities
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">Loading...</div>
            ) : synced.length === 0 ? (
              <EmptyState
                title="Nothing synced from Git yet"
                description="Once a sync run finds and applies YAML descriptors from your Git providers, the resulting Checkstack entities (systems, groups, health checks, …) appear here with provenance — what file they came from and which commit. That's how you know which resources are managed in Git versus created in the UI."
              />
            ) : (
              renderEntryList(synced, false)
            )}
          </CardContent>
        </Card>
      </div>

      <ConfirmationModal
        isOpen={confirmModal.isOpen}
        onClose={() => setConfirmModal({ isOpen: false, provenanceId: "", entityName: "" })}
        onConfirm={() => confirmDeleteMutation.mutate({ provenanceId: confirmModal.provenanceId })}
        title="Confirm Orphan Deletion"
        message={`Are you sure you want to permanently delete "${confirmModal.entityName}"? This will remove the entity from the system.`}
        confirmText="Delete"
        variant="danger"
      />
    </>
  );
};
