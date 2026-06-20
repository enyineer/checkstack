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
  EmptyState,
  ConfirmationModal,
  useToast,
  toastError,
  toastSuccess,
  usePerformance,
  cn,
} from "@checkstack/ui";
import type { LucideIcon } from "lucide-react";
import { useState } from "react";
import { CheckCircle, AlertTriangle, XCircle, Trash2, X } from "lucide-react";
import { toneStyles, cardSurface, type GitOpsTone } from "./statusTone";

/**
 * Map a provenance status to the colorblind-safe status triad tone. Status is
 * multi-encoded everywhere it appears (icon + dot + text label + accent
 * stripe), never color alone.
 */
const STATUS_TONE: Record<Provenance["status"], GitOpsTone> = {
  synced: "ok",
  error: "down",
  orphaned: "warn",
};

/**
 * A single number-led summary tile for the Sync Status grid: a hero count, a
 * demoted caption, a corner icon at reduced opacity, and a left accent stripe
 * keyed to the tile's signal. A zero count is dimmed so non-zero error/orphan
 * counts visually pop.
 */
const SummaryStat = ({
  count,
  label,
  tone,
  icon: Icon,
  animate,
}: {
  count: number;
  label: string;
  tone: GitOpsTone;
  icon: LucideIcon;
  animate: boolean;
}) => {
  const styles = toneStyles[tone];
  const isZero = count === 0;
  return (
    <div
      className={cn(
        cardSurface,
        "p-[var(--d-pad)] transition-all",
        animate && "animate-in fade-in duration-300",
      )}
    >
      <span
        className={cn(
          "absolute inset-y-0 left-0 w-1",
          styles.accent,
          isZero && "opacity-40",
        )}
        aria-hidden
      />
      <Icon
        className={cn(
          "absolute right-3 top-3 w-5 h-5",
          styles.text,
          isZero ? "opacity-30" : "opacity-70",
        )}
        aria-hidden
      />
      <div className="pl-2">
        <p
          className={cn(
            "text-3xl font-bold leading-none tabular-nums text-foreground",
            isZero && "text-muted-foreground",
          )}
        >
          {count}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{label}</p>
      </div>
    </div>
  );
};

export const ProvenanceStatus = () => {
  const client = usePluginClient(GitOpsApi);
  const accessApi = useApi(accessApiRef);
  const toast = useToast();

  const { isLowPower } = usePerformance();

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
      toastSuccess(toast, "Orphan deleted successfully");
      setConfirmModal({ isOpen: false, provenanceId: "", entityName: "" });
      void refetch();
    },
    onError: (error) => {
      toastError(toast, "Failed to delete orphan", error);
    },
  });

  const dismissMutation = client.dismissOrphan.useMutation({
    onSuccess: () => {
      toastSuccess(toast, "Orphan dismissed - entity is no longer tracked by GitOps");
      void refetch();
    },
    onError: (error) => {
      toastError(toast, "Failed to dismiss orphan", error);
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
        return <CheckCircle className="w-4 h-4 text-status-ok" />;
      }
      case "error": {
        return <XCircle className="w-4 h-4 text-status-down" />;
      }
      case "orphaned": {
        return <AlertTriangle className="w-4 h-4 text-status-warn" />;
      }
    }
  };

  const statusBadge = (status: Provenance["status"]) => {
    const styles = toneStyles[STATUS_TONE[status]];
    return (
      <span
        className={cn(
          "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
          styles.pill,
        )}
      >
        <span className={cn("size-1.5 rounded-full", styles.dot)} aria-hidden />
        {status}
      </span>
    );
  };

  const renderEntryList = (list: Provenance[], showOrphanActions: boolean) => (
    <div className="space-y-2">
      {list.map((entry) => {
        const accent = toneStyles[STATUS_TONE[entry.status]].accent;
        return (
        <div
          key={entry.id}
          className="relative overflow-hidden flex items-center justify-between p-3 pl-4 rounded-lg border border-border/70 bg-surface-inset hover:bg-surface-2 transition-colors"
        >
          <span
            className={cn("absolute inset-y-0 left-0 w-1", accent)}
            aria-hidden
          />
          <div className="flex items-center gap-3 min-w-0 pl-2">
            {statusIcon(entry.status)}
            <div className="min-w-0">
              <div className="text-sm font-semibold text-foreground">
                <span className="font-normal text-muted-foreground">
                  {entry.kind}/
                </span>
                {entry.entityName}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5 truncate">
                {entry.repository}/{entry.filePath}
              </div>
              {entry.errorMessage && (
                <div className="text-xs text-status-down mt-0.5 truncate">
                  {entry.errorMessage}
                </div>
              )}
              {entry.warnings.length > 0 && (
                <div className="mt-1 space-y-0.5">
                  {entry.warnings.map((warning, index) => (
                    <div
                      key={index}
                      className="text-xs text-status-warn flex items-start gap-1"
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
        );
      })}
    </div>
  );

  return (
    <>
      <div className="space-y-6">
        {/* Summary */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <SummaryStat
            count={synced.length}
            label="Synced"
            tone="ok"
            icon={CheckCircle}
            animate={!isLowPower}
          />
          <SummaryStat
            count={errors.length}
            label="Errors"
            tone="down"
            icon={XCircle}
            animate={!isLowPower}
          />
          <SummaryStat
            count={orphaned.length}
            label="Orphaned"
            tone="warn"
            icon={AlertTriangle}
            animate={!isLowPower}
          />
          <SummaryStat
            count={withWarnings.length}
            label="Warnings"
            tone="warn"
            icon={AlertTriangle}
            animate={!isLowPower}
          />
        </div>

        {/* Orphaned entities — shown first if any */}
        {orphaned.length > 0 && (
          <Card>
            <CardHeader>
              <CardHeaderRow>
                <CardTitle className="flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-status-warn" />
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
                <AlertTriangle className="w-5 h-5 text-status-warn" />
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
                <XCircle className="w-5 h-5 text-status-down" />
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
              <CheckCircle className="w-5 h-5 text-status-ok" />
              Synced Entities
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">Loading...</div>
            ) : synced.length === 0 ? (
              <EmptyState
                title="Nothing synced from Git yet"
                description="Once a sync run finds and applies YAML descriptors from your Git providers, the resulting Checkstack entities (systems, groups, health checks, …) appear here with provenance - what file they came from and which commit. That's how you know which resources are managed in Git versus created in the UI."
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
