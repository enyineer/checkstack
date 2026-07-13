import { useState } from "react";
import {
  usePluginClient,
  useApi,
  accessApiRef,
} from "@checkstack/frontend-api";
import {
  Card,
  CardHeader,
  CardHeaderRow,
  CardTitle,
  CardDescription,
  CardContent,
  Button,
  Toggle,
  StatusBadge,
  DataTable,
  ConfirmationModal,
  Skeleton,
  EmptyState,
  useToast,
  toastError,
  formatRelativeTime,
  cn,
  type DataTableColumn,
} from "@checkstack/ui";
import {
  Radar,
  Plus,
  Pencil,
  Trash2,
  TriangleAlert,
  Check,
  Ban,
  Server,
  Satellite,
} from "lucide-react";
import {
  MetricstreamApi,
  type MetricScrapeTarget,
} from "@checkstack/metricstream-common";
import { SatelliteApi, satelliteAccess } from "@checkstack/satellite-common";
import { ScrapeTargetDialog } from "./ScrapeTargetDialog";
import { resolveScrapeSourceBadge } from "../lib/scrape-from";

export interface ScrapeTargetsSectionProps {
  streamId: string;
  canManage: boolean;
}

/**
 * Prometheus scrape targets: a table with each target's schedule and last
 * scrape status (errors surfaced with a failing tone), inline enable/disable,
 * and create/edit/delete. All writes are contract-gated on the owning stream's
 * manage verdict.
 */
export function ScrapeTargetsSection({
  streamId,
  canManage,
}: ScrapeTargetsSectionProps) {
  const client = usePluginClient(MetricstreamApi);
  const satelliteClient = usePluginClient(SatelliteApi);
  const accessApi = useApi(accessApiRef);
  const toast = useToast();

  // Enrich the "Source" badge with satellite names only when the caller can
  // read satellites; otherwise a satellite-bound target still shows a generic
  // "Satellite" badge (no name), never a broken row or a 403.
  const { allowed: canReadSatellites } = accessApi.useAccess(
    satelliteAccess.satellite.read,
  );
  const { data: satelliteData } = satelliteClient.listSatellites.useQuery(
    undefined,
    { enabled: canReadSatellites },
  );
  const satellites = satelliteData?.satellites ?? [];

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<MetricScrapeTarget | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MetricScrapeTarget | null>(
    null,
  );

  const { data: targets, isLoading } = client.listScrapeTargets.useQuery({
    streamId,
  });

  const updateMutation = client.updateScrapeTarget.useGatedMutation({
    gateInput: { streamId },
    onError: (e) => toastError(toast, "Failed to update scrape target", e),
  });

  const deleteMutation = client.deleteScrapeTarget.useGatedMutation({
    gateInput: { streamId },
    onSuccess: () => {
      toast.success("Scrape target deleted");
      setDeleteTarget(null);
    },
    onError: (e) => toastError(toast, "Failed to delete scrape target", e),
  });

  const openCreate = () => {
    setEditTarget(null);
    setDialogOpen(true);
  };
  const openEdit = (target: MetricScrapeTarget) => {
    setEditTarget(target);
    setDialogOpen(true);
  };

  const columns: DataTableColumn<MetricScrapeTarget>[] = [
    {
      id: "name",
      header: "Name",
      sortValue: (t) => t.name.toLowerCase(),
      searchValue: (t) => `${t.name} ${t.url}`,
      cell: (t) => (
        <div className="min-w-0">
          <span className="block font-medium text-foreground">{t.name}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {t.url}
          </span>
        </div>
      ),
    },
    {
      id: "interval",
      header: "Interval",
      desktopOnly: true,
      sortValue: (t) => t.intervalSeconds,
      cell: (t) => (
        <span className="text-sm tabular-nums text-muted-foreground">
          {t.intervalSeconds}s
        </span>
      ),
    },
    {
      id: "source",
      header: "Source",
      desktopOnly: true,
      sortValue: (t) => (t.satelliteId === null ? "" : t.satelliteId),
      searchValue: (t) =>
        resolveScrapeSourceBadge({ satelliteId: t.satelliteId, satellites })
          .label,
      cell: (t) => {
        const badge = resolveScrapeSourceBadge({
          satelliteId: t.satelliteId,
          satellites,
        });
        const Icon = badge.isSatellite ? Satellite : Server;
        return (
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium",
              badge.isSatellite
                ? "bg-info/10 text-info"
                : "bg-muted text-muted-foreground",
            )}
            title={
              badge.isUnknownSatellite
                ? "Scraped by a satellite that is unavailable or not visible to you"
                : undefined
            }
          >
            <Icon className="size-3" aria-hidden />
            {badge.label}
          </span>
        );
      },
    },
    {
      id: "status",
      header: "Last scrape",
      cell: (t) => {
        if (t.lastError) {
          return (
            <div className="min-w-0">
              <StatusBadge tone="error" icon={TriangleAlert} label="Failing" />
              <span
                className="mt-0.5 block truncate text-xs text-destructive"
                title={t.lastError}
              >
                {t.lastError}
              </span>
            </div>
          );
        }
        return (
          <span className="text-sm text-muted-foreground tabular-nums">
            {t.lastScrapeAt ? formatRelativeTime(t.lastScrapeAt) : "Never"}
          </span>
        );
      },
    },
    {
      id: "enabled",
      header: "Enabled",
      cell: (t) =>
        canManage ? (
          <Toggle
            checked={t.enabled}
            onCheckedChange={(checked) =>
              updateMutation.mutate({
                streamId,
                targetId: t.id,
                enabled: checked,
              })
            }
          />
        ) : (
          <StatusBadge
            tone={t.enabled ? "ok" : "neutral"}
            icon={t.enabled ? Check : Ban}
            label={t.enabled ? "On" : "Off"}
          />
        ),
    },
    {
      id: "actions",
      header: "",
      cell: (t) =>
        canManage ? (
          <div className="flex items-center justify-end gap-1">
            <Button variant="ghost" size="sm" onClick={() => openEdit(t)}>
              <Pencil className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDeleteTarget(t)}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        ) : null,
      cellClassName: "text-right",
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardHeaderRow>
          <div>
            <CardTitle>Scrape targets</CardTitle>
            <CardDescription>
              Checkstack pulls these Prometheus-format endpoints on a schedule
              and folds the exposed metrics into this stream.
            </CardDescription>
          </div>
          {canManage && (
            <Button onClick={openCreate}>
              <Plus className="size-4" />
              Add target
            </Button>
          )}
        </CardHeaderRow>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2" aria-busy="true">
            <Skeleton variant="row" />
            <Skeleton variant="row" />
          </div>
        ) : (targets ?? []).length === 0 ? (
          <EmptyState
            icon={<Radar className="h-6 w-6" />}
            title="No scrape targets"
            description="Add a target to pull metrics from a Prometheus-format endpoint."
            actions={
              canManage ? (
                <Button onClick={openCreate}>
                  <Plus className="size-4" />
                  Add target
                </Button>
              ) : undefined
            }
          />
        ) : (
          <DataTable
            data={targets ?? []}
            columns={columns}
            getRowId={(t) => t.id}
            searchable
            searchPlaceholder="Search targets..."
            defaultSort={{ columnId: "name", direction: "asc" }}
            surface={false}
          />
        )}
      </CardContent>

      <ScrapeTargetDialog
        streamId={streamId}
        target={editTarget}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />

      <ConfirmationModal
        isOpen={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() =>
          deleteTarget &&
          deleteMutation.mutate({ streamId, targetId: deleteTarget.id })
        }
        title="Delete scrape target"
        message={
          <>
            Delete <strong>{deleteTarget?.name}</strong>? Checkstack will stop
            scraping <code className={cn("font-mono")}>{deleteTarget?.url}</code>
            . This cannot be undone.
          </>
        }
        confirmText="Delete target"
        variant="danger"
        isLoading={deleteMutation.isPending}
      />
    </Card>
  );
}
