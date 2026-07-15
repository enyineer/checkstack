import { useMemo, useState } from "react";
import { useApi, usePluginClient, accessApiRef } from "@checkstack/frontend-api";
import {
  PageLayout,
  EmptyState,
  DataTable,
  Button,
  Toggle,
  StatusBadge,
  ConfirmationModal,
  DynamicIcon,
  Skeleton,
  QueryErrorState,
  formatRelativeTime,
  useToast,
  toastError,
  type DataTableColumn,
  type LucideIconName,
} from "@checkstack/ui";
import {
  Cable,
  Plus,
  Pencil,
  Trash2,
  KeyRound,
  Check,
  Ban,
  TriangleAlert,
} from "lucide-react";
import { signalScopeMeta } from "@checkstack/signal-common";
import {
  TelemetryApi,
  telemetryAccess,
  telemetryResourceTypes,
  type SourceTypeDescriptor,
  type TelemetrySource,
} from "@checkstack/telemetry-common";
import { indexSourceTypes } from "../lib/sources-section.logic";
import { isPushType, isWebhookType } from "../lib/source-form.logic";
import { deriveSourceHealth } from "../lib/source-health.logic";
import { SourceBindingsSummary } from "../components/SourceBindingsSummary";
import { AddSourceDialog } from "../components/AddSourceDialog";
import { EditSourceDialog } from "../components/EditSourceDialog";
import { RotateSecretDialog } from "../components/RotateSecretDialog";

/**
 * Global Sources page: every telemetry source instance the caller may read,
 * across all streams and signals, in one table. "Add source" opens the full
 * catalog with no preset binding, so the multi-signal binding editor drives
 * routing. Per-row management (enable, edit, rotate, delete) is gated on the
 * caller's manage grant for that instance.
 *
 * Read filtering, per-row manage verdicts and query invalidation all mirror the
 * stream-embedded `StreamSourcesSection`; this page is the un-scoped counterpart.
 */
export function SourcesPage() {
  const client = usePluginClient(TelemetryApi);
  const accessApi = useApi(accessApiRef);
  const toast = useToast();

  const [addOpen, setAddOpen] = useState(false);
  const [editState, setEditState] = useState<{
    source: TelemetrySource;
    descriptor: SourceTypeDescriptor;
  } | null>(null);
  const [rotateState, setRotateState] = useState<{
    source: TelemetrySource;
    descriptor: SourceTypeDescriptor;
  } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TelemetrySource | null>(null);

  const {
    data: sourcesData,
    isLoading,
    isError,
    error,
    refetch,
  } = client.listSources.useQuery({}, { meta: signalScopeMeta });
  const { data: typesData, isLoading: typesLoading } =
    client.listSourceTypes.useQuery({});

  const sources = useMemo(
    () => sourcesData?.sources ?? [],
    [sourcesData],
  );
  const sourceTypes = useMemo(
    () => typesData?.sourceTypes ?? [],
    [typesData],
  );
  const typeIndex = useMemo(() => indexSourceTypes(sourceTypes), [sourceTypes]);

  const { allowed: canCreate } = accessApi.useProcedureAccess(
    TelemetryApi.contract.createSource,
  );
  const resourceIds = useMemo(() => sources.map((s) => s.id), [sources]);
  const { canAccess } = accessApi.useResourceAccess({
    accessRule: telemetryAccess.manage,
    objectType: telemetryResourceTypes.source,
    resourceIds,
  });

  const toggleMutation = client.updateSource.useMutation({
    onError: (e) => toastError(toast, "Failed to update source", e),
  });
  const deleteMutation = client.deleteSource.useMutation({
    onSuccess: () => {
      toast.success("Source deleted");
      setDeleteTarget(null);
    },
    onError: (e) => toastError(toast, "Failed to delete source", e),
  });

  const createButton = canCreate ? (
    <Button onClick={() => setAddOpen(true)}>
      <Plus className="h-4 w-4" />
      Add source
    </Button>
  ) : undefined;

  const columns: DataTableColumn<TelemetrySource>[] = [
    {
      id: "name",
      header: "Name",
      sortValue: (s) => s.name.toLowerCase(),
      searchValue: (s) => s.name,
      cell: (s) => (
        <div className="min-w-0">
          <span className="block font-medium text-foreground">{s.name}</span>
          {s.description && (
            <span className="block text-xs text-muted-foreground line-clamp-1">
              {s.description}
            </span>
          )}
        </div>
      ),
    },
    {
      id: "type",
      header: "Type",
      desktopOnly: true,
      sortValue: (s) => typeIndex.get(s.sourceTypeId)?.displayName ?? s.sourceTypeId,
      cell: (s) => {
        const descriptor = typeIndex.get(s.sourceTypeId);
        return (
          <div className="flex items-center gap-2">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-surface-inset text-foreground">
              <DynamicIcon
                name={(descriptor?.icon as LucideIconName | undefined) ?? undefined}
                className="size-4"
              />
            </span>
            <span className="text-sm text-foreground">
              {descriptor?.displayName ?? s.sourceTypeId}
            </span>
          </div>
        );
      },
    },
    {
      id: "routing",
      header: "Routing",
      cell: (s) => (
        <SourceBindingsSummary
          bindings={s.bindings}
          bindingStreamNames={s.bindingStreamNames}
        />
      ),
    },
    {
      id: "status",
      header: "Enabled",
      sortValue: (s) => (s.enabled ? 1 : 0),
      cell: (s) =>
        canAccess(s.id) ? (
          <Toggle
            checked={s.enabled}
            disabled={toggleMutation.isPending}
            onCheckedChange={(checked) =>
              toggleMutation.mutate({ id: s.id, body: { enabled: checked } })
            }
          />
        ) : (
          <StatusBadge
            tone={s.enabled ? "ok" : "neutral"}
            icon={s.enabled ? Check : Ban}
            label={s.enabled ? "On" : "Off"}
          />
        ),
    },
    {
      id: "health",
      header: "Health",
      desktopOnly: true,
      sortValue: (s) => s.consecutiveFailures,
      cell: (s) => {
        const health = deriveSourceHealth(s);
        return health.failing ? (
          <span
            className="inline-flex items-center gap-1.5 rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive"
            title={health.lastError ?? undefined}
          >
            <TriangleAlert className="size-3" aria-hidden />
            Failing
            {health.consecutiveFailures > 1 ? ` (${health.consecutiveFailures})` : ""}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">Healthy</span>
        );
      },
    },
    {
      id: "lastRun",
      header: "Last run",
      desktopOnly: true,
      sortValue: (s) => (s.lastRunAt ? new Date(s.lastRunAt).getTime() : 0),
      cell: (s) => {
        const health = deriveSourceHealth(s);
        return (
          <span className="text-sm text-muted-foreground tabular-nums">
            {health.timeLabel === "ran" ? "Ran " : "Updated "}
            {formatRelativeTime(health.timeAt)}
          </span>
        );
      },
    },
    {
      id: "actions",
      header: "",
      cell: (s) => {
        const descriptor = typeIndex.get(s.sourceTypeId);
        if (!canAccess(s.id) || !descriptor) return null;
        return (
          <div className="flex items-center justify-end gap-1">
            <Button
              variant="ghost"
              size="sm"
              aria-label="Edit source"
              onClick={() => setEditState({ source: s, descriptor })}
            >
              <Pencil className="size-4" />
            </Button>
            {(isWebhookType(descriptor) || isPushType(descriptor)) && (
              <Button
                variant="ghost"
                size="sm"
                aria-label={
                  isPushType(descriptor)
                    ? "Rotate source token"
                    : "Rotate webhook secret"
                }
                onClick={() => setRotateState({ source: s, descriptor })}
              >
                <KeyRound className="size-4" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              aria-label="Delete source"
              onClick={() => setDeleteTarget(s)}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        );
      },
    },
  ];

  return (
    <PageLayout
      title="Sources"
      subtitle="Push endpoints, pollers, webhooks and listeners that ingest telemetry into your streams"
      icon={Cable}
      actions={sources.length > 0 ? createButton : undefined}
    >
      {isLoading || typesLoading ? (
        <div className="space-y-2" aria-busy="true">
          <Skeleton variant="row" />
          <Skeleton variant="row" />
          <Skeleton variant="row" />
        </div>
      ) : isError ? (
        <QueryErrorState
          error={error}
          resource="sources"
          onRetry={() => void refetch()}
        />
      ) : sources.length === 0 ? (
        <EmptyState
          icon={<Cable className="h-8 w-8" />}
          title="Ingest telemetry from anywhere"
          description="A source pushes, pulls, or receives telemetry from an external system - an OTLP shipper, a Prometheus endpoint, a vendor webhook, a syslog listener - and routes it into your log and metric streams."
          steps={
            sourceTypes.length === 0
              ? [
                  "Install a plugin that contributes a telemetry source type.",
                  "Add a source and point it at your system.",
                  "Route each signal it emits into a stream you manage.",
                ]
              : undefined
          }
          actions={sourceTypes.length > 0 ? createButton : undefined}
        />
      ) : (
        <DataTable
          data={sources}
          columns={columns}
          getRowId={(s) => s.id}
          searchable
          searchPlaceholder="Search sources..."
          defaultSort={{ columnId: "name", direction: "asc" }}
        />
      )}

      <AddSourceDialog
        sourceTypes={sourceTypes}
        open={addOpen}
        onOpenChange={setAddOpen}
      />

      {editState && (
        <EditSourceDialog
          descriptor={editState.descriptor}
          source={editState.source}
          open={editState !== null}
          onOpenChange={(open) => !open && setEditState(null)}
        />
      )}

      {rotateState && (
        <RotateSecretDialog
          source={rotateState.source}
          descriptor={rotateState.descriptor}
          open={rotateState !== null}
          onOpenChange={(open) => !open && setRotateState(null)}
        />
      )}

      <ConfirmationModal
        isOpen={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() =>
          deleteTarget && deleteMutation.mutate({ id: deleteTarget.id })
        }
        title="Delete source"
        message={
          <>
            Delete <strong>{deleteTarget?.name}</strong>? Checkstack will stop
            ingesting telemetry from it. This cannot be undone.
          </>
        }
        confirmText="Delete source"
        variant="danger"
        isLoading={deleteMutation.isPending}
      />
    </PageLayout>
  );
}
