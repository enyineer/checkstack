import { useState } from "react";
import { usePluginClient } from "@checkstack/frontend-api";
import {
  Badge,
  Button,
  Toggle,
  StatusBadge,
  ConfirmationModal,
  DynamicIcon,
  useToast,
  toastError,
  formatRelativeTime,
  type LucideIconName,
} from "@checkstack/ui";
import { Pencil, Trash2, KeyRound, Check, Ban, TriangleAlert } from "lucide-react";
import {
  TelemetryApi,
  type SourceTypeDescriptor,
  type TelemetrySource,
} from "@checkstack/telemetry-common";
import { isPullType, isWebhookType } from "../lib/source-form.logic";
import { deriveSourceHealth } from "../lib/source-health.logic";
import { EditSourceDialog } from "./EditSourceDialog";
import { RotateSecretDialog } from "./RotateSecretDialog";
import { TestConnectionButton } from "./TestConnectionButton";

export interface SourceInstanceListProps {
  sources: TelemetrySource[];
  /** Descriptors by qualified id, for per-row type display and config editing. */
  typeIndex: Map<string, SourceTypeDescriptor>;
  /** Per-row manage verdict (ReBAC-aware), from the parent's useResourceAccess. */
  canManage: (id: string) => boolean;
}

/**
 * List of a stream's bound source instances. Each row shows the source's name,
 * its type (icon + display name) and mode badges, an enable/disable toggle, and
 * manage actions (edit, delete, and - for webhook types - rotate secret). Pull
 * types expose an inline "Test connection" that reuses the instance's stored
 * secrets. All writes are gated on the per-row manage verdict.
 */
export function SourceInstanceList({
  sources,
  typeIndex,
  canManage,
}: SourceInstanceListProps) {
  const client = usePluginClient(TelemetryApi);
  const toast = useToast();

  const [editState, setEditState] = useState<{
    source: TelemetrySource;
    descriptor: SourceTypeDescriptor;
  } | null>(null);
  const [rotateSource, setRotateSource] = useState<TelemetrySource | null>(null);
  const [deleteSource, setDeleteSource] = useState<TelemetrySource | null>(null);

  const toggleMutation = client.updateSource.useMutation({
    onError: (e) => toastError(toast, "Failed to update source", e),
  });

  const deleteMutation = client.deleteSource.useMutation({
    onSuccess: () => {
      toast.success("Source deleted");
      setDeleteSource(null);
    },
    onError: (e) => toastError(toast, "Failed to delete source", e),
  });

  return (
    <ul className="space-y-2">
      {sources.map((source) => {
        const descriptor = typeIndex.get(source.sourceTypeId);
        const manageable = canManage(source.id);
        const health = deriveSourceHealth(source);
        return (
          <li
            key={source.id}
            className="space-y-3 rounded-lg border border-border bg-card p-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3">
                <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-md bg-surface-inset text-foreground">
                  <DynamicIcon
                    // `icon` is a free-form string from the descriptor; bridge
                    // it to the lucide name type as other catalogs do.
                    name={
                      (descriptor?.icon as LucideIconName | undefined) ??
                      undefined
                    }
                    className="size-5"
                  />
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-foreground">
                      {source.name}
                    </span>
                    {descriptor && (
                      <Badge variant="secondary">
                        {descriptor.displayName}
                      </Badge>
                    )}
                    {descriptor?.modes.map((mode) => (
                      <Badge
                        key={mode}
                        variant="outline"
                        className="capitalize"
                      >
                        {mode}
                      </Badge>
                    ))}
                  </div>
                  {source.description && (
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {source.description}
                    </p>
                  )}
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                    {health.failing && (
                      <span
                        className="inline-flex items-center gap-1.5 rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive"
                        title={health.lastError ?? undefined}
                      >
                        <TriangleAlert className="size-3" aria-hidden />
                        Failing
                        {health.consecutiveFailures > 1
                          ? ` (${health.consecutiveFailures})`
                          : ""}
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {health.timeLabel === "ran" ? "Ran" : "Updated"}{" "}
                      {formatRelativeTime(health.timeAt)}
                    </span>
                  </div>
                  {health.failing && health.lastError && (
                    <p
                      className="mt-0.5 truncate text-xs text-destructive"
                      title={health.lastError}
                    >
                      {health.lastError}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-1">
                {manageable ? (
                  <Toggle
                    checked={source.enabled}
                    disabled={toggleMutation.isPending}
                    onCheckedChange={(checked) =>
                      toggleMutation.mutate({
                        id: source.id,
                        body: { enabled: checked },
                      })
                    }
                  />
                ) : (
                  <StatusBadge
                    tone={source.enabled ? "ok" : "neutral"}
                    icon={source.enabled ? Check : Ban}
                    label={source.enabled ? "On" : "Off"}
                  />
                )}

                {manageable && descriptor && (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label="Edit source"
                    onClick={() => setEditState({ source, descriptor })}
                  >
                    <Pencil className="size-4" />
                  </Button>
                )}
                {manageable && descriptor && isWebhookType(descriptor) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label="Rotate webhook secret"
                    onClick={() => setRotateSource(source)}
                  >
                    <KeyRound className="size-4" />
                  </Button>
                )}
                {manageable && (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label="Delete source"
                    onClick={() => setDeleteSource(source)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                )}
              </div>
            </div>

            {manageable && descriptor && isPullType(descriptor) && (
              <TestConnectionButton
                sourceTypeId={source.sourceTypeId}
                config={source.config}
                sourceId={source.id}
              />
            )}
          </li>
        );
      })}

      {editState && (
        <EditSourceDialog
          descriptor={editState.descriptor}
          source={editState.source}
          open={editState !== null}
          onOpenChange={(open) => !open && setEditState(null)}
        />
      )}

      {rotateSource && (
        <RotateSecretDialog
          source={rotateSource}
          open={rotateSource !== null}
          onOpenChange={(open) => !open && setRotateSource(null)}
        />
      )}

      <ConfirmationModal
        isOpen={deleteSource !== null}
        onClose={() => setDeleteSource(null)}
        onConfirm={() =>
          deleteSource && deleteMutation.mutate({ id: deleteSource.id })
        }
        title="Delete source"
        message={
          <>
            Delete <strong>{deleteSource?.name}</strong>? Checkstack will stop
            ingesting telemetry from it. This cannot be undone.
          </>
        }
        confirmText="Delete source"
        variant="danger"
        isLoading={deleteMutation.isPending}
      />
    </ul>
  );
}
