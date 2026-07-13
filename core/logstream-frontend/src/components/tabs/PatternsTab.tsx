import { useMemo, useState } from "react";
import { useApi, usePluginClient, accessApiRef } from "@checkstack/frontend-api";
import {
  DataTable,
  StatusBadge,
  Badge,
  Button,
  Skeleton,
  QueryErrorState,
  EmptyState,
  ConfirmationModal,
  formatNumber,
  formatRelativeTime,
  useToast,
  cn,
  type DataTableColumn,
} from "@checkstack/ui";
import { extractErrorMessage } from "@checkstack/common";
import { LogstreamApi, type LogPattern } from "@checkstack/logstream-common";
import { ScrollText, Search, Trash2, Plus } from "lucide-react";
import {
  severityBandIcon,
  severityBandLabel,
  severityBandToTone,
} from "../../lib/severity-tone";
import { PatternTemplate } from "../PatternTemplate";
import { PatternBuilderDialog } from "../PatternBuilderDialog";

export interface PatternsTabProps {
  streamId: string;
  onExplorePattern: (patternId: string) => void;
}

/**
 * Sort user-authored patterns before mined ones, then by cumulative count. This
 * is the STABLE base order; the DataTable's own (stable) sort preserves the
 * user-first tiebreak within equal keys of whichever column is active.
 */
function sortPatterns(patterns: LogPattern[]): LogPattern[] {
  return patterns.toSorted((a, b) => {
    if (a.origin !== b.origin) return a.origin === "user" ? -1 : 1;
    return b.totalCount - a.totalCount;
  });
}

/** Patterns tab: the stream's templates with counts, recency, origin and worst severity. */
export function PatternsTab({ streamId, onExplorePattern }: PatternsTabProps) {
  const client = usePluginClient(LogstreamApi);
  const accessApi = useApi(accessApiRef);
  const toast = useToast();

  const { data, isLoading, isError, error, refetch } =
    client.listPatterns.useQuery({ streamId, limit: 500 });

  const { allowed: canCreate } = accessApi.useProcedureAccess(
    LogstreamApi.contract.createPattern,
    { streamId },
  );

  const deleteMutation = client.deletePattern.useGatedMutation({
    gateInput: { streamId },
    onSuccess: () => {
      toast.success("Pattern deleted");
      setDeleteTarget(null);
    },
    // A pattern still referenced by a check returns a friendly 409 - surface the
    // server's message verbatim so the operator knows which checks to detach.
    onError: (err) => toast.error(extractErrorMessage(err)),
  });

  const [builderOpen, setBuilderOpen] = useState(false);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<LogPattern | null>(null);

  const patterns = useMemo(() => sortPatterns(data ?? []), [data]);

  const columns: DataTableColumn<LogPattern>[] = [
    {
      id: "template",
      header: "Template",
      searchValue: (p) => p.template,
      cell: (p) => <PatternTemplate template={p.template} />,
    },
    {
      id: "origin",
      header: "Origin",
      sortValue: (p) => (p.origin === "user" ? 0 : 1),
      cell: (p) =>
        p.origin === "user" ? (
          <Badge variant="info">User</Badge>
        ) : (
          <Badge variant="outline">Mined</Badge>
        ),
    },
    {
      id: "severity",
      header: "Severity",
      sortValue: (p) => p.severityMax,
      cell: (p) => (
        <StatusBadge
          tone={severityBandToTone(p.band)}
          icon={severityBandIcon(p.band)}
          label={severityBandLabel(p.band)}
        />
      ),
    },
    {
      id: "count",
      header: "Count",
      sortValue: (p) => p.totalCount,
      cell: (p) => (
        <span className="tabular-nums text-sm">{formatNumber(p.totalCount)}</span>
      ),
    },
    {
      id: "lastSeen",
      header: "Last seen",
      desktopOnly: true,
      sortValue: (p) => new Date(p.lastSeenAt).getTime(),
      cell: (p) => (
        <span className="text-sm text-muted-foreground tabular-nums">
          {formatRelativeTime(p.lastSeenAt)}
        </span>
      ),
    },
    {
      id: "actions",
      header: "",
      cell: (p) => (
        <div className="flex items-center justify-end gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              onExplorePattern(p.id);
            }}
          >
            <Search className="h-4 w-4" />
            Explore
          </Button>
          {p.origin === "user" && deleteMutation.allowed && (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Delete pattern"
              onClick={(e) => {
                e.stopPropagation();
                setDeleteTarget(p);
              }}
            >
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          )}
        </div>
      ),
    },
  ];

  const newPatternButton = canCreate ? (
    <Button size="sm" onClick={() => setBuilderOpen(true)}>
      <Plus className="h-4 w-4" />
      New pattern
    </Button>
  ) : undefined;

  const onCreated = (patternId: string) => {
    setHighlightId(patternId);
    // Fade the highlight after a few seconds; no animation, just a timed clear.
    setTimeout(() => setHighlightId((id) => (id === patternId ? null : id)), 4000);
  };

  if (isLoading) {
    return (
      <div className="space-y-2" aria-busy="true">
        <Skeleton variant="row" />
        <Skeleton variant="row" />
        <Skeleton variant="row" />
      </div>
    );
  }
  if (isError) {
    return (
      <QueryErrorState
        error={error}
        resource="patterns"
        onRetry={() => void refetch()}
      />
    );
  }

  return (
    <>
      {patterns.length === 0 ? (
        <EmptyState
          icon={<ScrollText className="h-8 w-8" />}
          title="No patterns yet"
          description="Checkstack groups similar lines into patterns as logs arrive. You can also create your own pattern up front."
          actions={newPatternButton}
        />
      ) : (
        <DataTable
          data={patterns}
          columns={columns}
          getRowId={(p) => p.id}
          searchable
          searchPlaceholder="Search templates..."
          defaultSort={{ columnId: "count", direction: "desc" }}
          onRowClick={(p) => onExplorePattern(p.id)}
          toolbar={newPatternButton}
          getRowProps={(p) => ({
            className: cn(
              highlightId === p.id &&
                "bg-primary/10 ring-1 ring-inset ring-primary/40",
            ),
          })}
        />
      )}

      <PatternBuilderDialog
        streamId={streamId}
        open={builderOpen}
        onOpenChange={setBuilderOpen}
        onCreated={onCreated}
        maskLine={(body) =>
          client.maskLine.call({ streamId, body }).then((r) => r.template)
        }
      />

      <ConfirmationModal
        isOpen={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) {
            deleteMutation.mutate({ streamId, patternId: deleteTarget.id });
          }
        }}
        title="Delete pattern"
        message={
          <>
            This permanently deletes the user pattern{" "}
            <code className="font-mono text-xs">{deleteTarget?.template}</code>.
            Lines already classified into it keep their label; new lines will be
            re-mined. A pattern still referenced by a health check cannot be
            deleted.
          </>
        }
        confirmText="Delete pattern"
        variant="danger"
        isLoading={deleteMutation.isPending}
      />
    </>
  );
}
