import { useEffect, useMemo, useState } from "react";
import { usePluginClient } from "@checkstack/frontend-api";
import {
  Input,
  Button,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  DateRangeFilter,
  VirtualList,
  StatusBadge,
  Skeleton,
  EmptyState,
  QueryErrorState,
  cn,
  formatSpanDuration,
  formatRelativeTime,
  formatNumber,
  type DateRange,
} from "@checkstack/ui";
import { CircleAlert, Search, X } from "lucide-react";
import {
  TracestreamApi,
  type TraceStatusFilter,
  type TraceSummary,
} from "@checkstack/tracestream-common";
import {
  EMPTY_TRACE_FILTERS,
  effectiveTraceRange,
  hasActiveTraceFilters,
  maxTraceDuration,
  mergeOlderTraces,
  parseDurationInput,
  toTraceSearchInput,
  type TraceSearchFilters,
} from "../../lib/trace-search";
import { TraceView } from "../TraceView";

const PAGE_LIMIT = 50;
const STATUS_OPTIONS: { id: TraceStatusFilter | "any"; label: string }[] = [
  { id: "any", label: "Any" },
  { id: "error", label: "Errors" },
  { id: "ok", label: "OK" },
];

export interface TracesTabProps {
  streamId: string;
  /** Deep-linked trace to open on mount (from the overview / a shared link). */
  initialTraceId?: string | null;
  /** Deep-linked service filter (from the overview top-services / a link). */
  initialServiceName?: string | null;
  /** Keep the opened trace in the URL so a refresh / share re-opens it. */
  onOpenTraceChange?: (traceId: string | null) => void;
}

/**
 * Traces tab: a filterable, keyset-paginated trace search. The newest page is a
 * live `useQuery` (auto-invalidated by same-plugin signals, keep-previous so a
 * refresh never yanks scroll); older pages are fetched imperatively and merged
 * with de-duplication ("Load older"). Clicking a row opens the {@link TraceView}
 * waterfall + span detail.
 */
export function TracesTab({
  streamId,
  initialTraceId,
  initialServiceName,
  onOpenTraceChange,
}: TracesTabProps) {
  const client = usePluginClient(TracestreamApi);

  const [filters, setFilters] = useState<TraceSearchFilters>(() => ({
    ...EMPTY_TRACE_FILTERS,
    serviceName: initialServiceName ?? null,
  }));
  const [openTraceId, setOpenTraceId] = useState<string | null>(
    initialTraceId ?? null,
  );
  const [olderPages, setOlderPages] = useState<TraceSummary[]>([]);
  const [nextCursorObj, setNextCursorObj] = useState<
    { startTs: Date; traceId: string } | null
  >(null);
  const [loadingOlder, setLoadingOlder] = useState(false);

  const openTrace = (traceId: string | null) => {
    setOpenTraceId(traceId);
    onOpenTraceChange?.(traceId);
  };

  // Quantized fallback window (stable identity across unrelated re-renders).
  const fallbackNow = Math.ceil(Date.now() / 60_000) * 60_000;
  const range: DateRange = useMemo(() => {
    const r = effectiveTraceRange({
      from: filters.from,
      to: filters.to,
      now: fallbackNow,
    });
    return { startDate: r.startDate, endDate: r.endDate };
  }, [filters.from, filters.to, fallbackNow]);

  const searchInput = toTraceSearchInput({
    streamId,
    filters,
    range: { startDate: range.startDate, endDate: range.endDate },
    limit: PAGE_LIMIT,
  });

  const {
    data: firstPage,
    isLoading,
    isError,
    error,
    isFetching,
    refetch,
  } = client.searchTraces.useQuery(searchInput, {
    placeholderData: (prev) => prev,
  });

  const { data: servicesData } = client.listServices.useQuery({ streamId });
  const services = servicesData?.services ?? [];

  const { data: operationsData } = client.listOperations.useQuery(
    { streamId, serviceName: filters.serviceName ?? "" },
    { enabled: filters.serviceName !== null },
  );
  const operations = operationsData?.operations ?? [];

  // Reset accumulated older pages whenever the user-driven facets change.
  const facetKey = JSON.stringify({
    serviceName: filters.serviceName,
    spanName: filters.spanName,
    status: filters.status,
    minDurationMs: filters.minDurationMs,
    maxDurationMs: filters.maxDurationMs,
    traceId: filters.traceId?.trim() ?? null,
    from: filters.from?.toISOString() ?? null,
    to: filters.to?.toISOString() ?? null,
  });
  useEffect(() => {
    setOlderPages([]);
    setNextCursorObj(null);
  }, [facetKey]);

  const traces = useMemo(
    () =>
      mergeOlderTraces({
        current: firstPage?.traces ?? [],
        incoming: olderPages,
      }),
    [firstPage, olderPages],
  );

  const baseCursor = firstPage?.nextCursor ?? null;
  const effectiveCursor =
    olderPages.length > 0 ? nextCursorObj : baseCursor;
  const hasMore = effectiveCursor !== null;
  const visibleMax = maxTraceDuration(traces);

  const loadOlder = async () => {
    if (loadingOlder || !effectiveCursor) return;
    setLoadingOlder(true);
    try {
      const res = await client.searchTraces.call(
        toTraceSearchInput({
          streamId,
          filters,
          range: { startDate: range.startDate, endDate: range.endDate },
          cursor: effectiveCursor,
          limit: PAGE_LIMIT,
        }),
      );
      setOlderPages((prev) =>
        mergeOlderTraces({ current: prev, incoming: res.traces }),
      );
      setNextCursorObj(res.nextCursor);
    } finally {
      setLoadingOlder(false);
    }
  };

  if (openTraceId) {
    return (
      <TraceView
        streamId={streamId}
        traceId={openTraceId}
        onBack={() => openTrace(null)}
      />
    );
  }

  const timeFiltered = filters.from !== null || filters.to !== null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 rounded-lg border bg-card p-3">
        {/* Row 1: trace id lookup + time range. */}
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={filters.traceId ?? ""}
              onChange={(e) =>
                setFilters((f) => ({ ...f, traceId: e.target.value || null }))
              }
              placeholder="Paste a trace ID..."
              className="pl-8 font-mono"
              aria-label="Look up a trace by ID"
            />
          </div>
          <DateRangeFilter
            value={range}
            onChange={(r) =>
              setFilters((f) => ({ ...f, from: r.startDate, to: r.endDate }))
            }
          />
        </div>

        {/* Row 2: service + operation + status + duration bounds. */}
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={filters.serviceName ?? "all"}
            onValueChange={(v) =>
              setFilters((f) => ({
                ...f,
                serviceName: v === "all" ? null : v,
                // Clear a now-orphaned operation when the service changes.
                spanName: null,
              }))
            }
          >
            <SelectTrigger className="w-full sm:w-52" aria-label="Filter by service">
              <SelectValue placeholder="All services" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All services</SelectItem>
              {services.map((s) => (
                <SelectItem key={s.serviceName} value={s.serviceName}>
                  {s.serviceName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={filters.spanName ?? "all"}
            onValueChange={(v) =>
              setFilters((f) => ({ ...f, spanName: v === "all" ? null : v }))
            }
            disabled={filters.serviceName === null}
          >
            <SelectTrigger
              className="w-full sm:w-52"
              aria-label="Filter by operation"
            >
              <SelectValue placeholder="All operations" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All operations</SelectItem>
              {operations.map((o) => (
                <SelectItem key={o.spanName} value={o.spanName}>
                  <span className="font-mono text-xs">{o.spanName}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="inline-flex overflow-hidden rounded-md border">
            {STATUS_OPTIONS.map((opt) => {
              const isActive =
                (filters.status ?? "any") === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() =>
                    setFilters((f) => ({
                      ...f,
                      status: opt.id === "any" ? null : opt.id,
                    }))
                  }
                  className={cn(
                    "px-2.5 py-1.5 text-xs font-medium",
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "bg-card text-muted-foreground hover:bg-surface-inset",
                  )}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>

          <Input
            type="number"
            min={0}
            placeholder="Min ms"
            className="w-24"
            aria-label="Minimum duration in ms"
            value={filters.minDurationMs ?? ""}
            onChange={(e) =>
              setFilters((f) => ({
                ...f,
                minDurationMs: parseDurationInput(e.target.value),
              }))
            }
          />
          <Input
            type="number"
            min={0}
            placeholder="Max ms"
            className="w-24"
            aria-label="Maximum duration in ms"
            value={filters.maxDurationMs ?? ""}
            onChange={(e) =>
              setFilters((f) => ({
                ...f,
                maxDurationMs: parseDurationInput(e.target.value),
              }))
            }
          />

          {(hasActiveTraceFilters(filters) || timeFiltered) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setFilters(EMPTY_TRACE_FILTERS)}
            >
              <X className="size-4" />
              Clear
            </Button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2" aria-busy="true">
          <Skeleton variant="row" />
          <Skeleton variant="row" />
          <Skeleton variant="row" />
        </div>
      ) : isError ? (
        <QueryErrorState
          error={error}
          resource="traces"
          onRetry={() => void refetch()}
        />
      ) : traces.length === 0 ? (
        <EmptyState
          icon={<Search className="h-8 w-8" />}
          title="No matching traces"
          description="No traces match these filters in the selected range. Loosen a filter or widen the time range."
        />
      ) : (
        <>
          <div
            className={cn(
              "overflow-hidden rounded-lg border bg-card",
              isFetching && "opacity-70",
            )}
          >
            <VirtualList
              items={traces}
              getKey={({ item }) => item.traceId}
              estimateSize={() => 56}
              className="h-[60vh]"
              renderItem={({ item }) => (
                <TraceSummaryRow
                  trace={item}
                  maxDurationMs={visibleMax}
                  onOpen={() => openTrace(item.traceId)}
                />
              )}
            />
          </div>

          <div className="flex justify-center">
            {hasMore ? (
              <Button
                variant="outline"
                onClick={() => void loadOlder()}
                disabled={loadingOlder}
              >
                {loadingOlder ? "Loading..." : "Load older"}
              </Button>
            ) : (
              <span className="py-2 text-xs text-muted-foreground">
                End of results
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function TraceSummaryRow({
  trace,
  maxDurationMs,
  onOpen,
}: {
  trace: TraceSummary;
  maxDurationMs: number;
  onOpen: () => void;
}) {
  const widthPct =
    maxDurationMs > 0 ? Math.max(2, (trace.durationMs / maxDurationMs) * 100) : 0;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-3 border-b border-border/40 px-3 py-2 text-left hover:bg-surface-inset"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="min-w-0 truncate text-sm font-medium text-foreground">
            {trace.rootSpanName ?? "unknown"}
          </span>
          {trace.hasError && (
            <StatusBadge tone="error" icon={CircleAlert} label="Error" />
          )}
        </div>
        <div className="mt-0.5 flex items-center gap-3 text-xs text-muted-foreground">
          <span className="truncate">
            {trace.rootServiceName ?? "unknown service"}
          </span>
          <span className="tabular-nums">
            {formatNumber(trace.spanCount)} spans
          </span>
          <span className="tabular-nums">
            {formatRelativeTime(trace.startTs)}
          </span>
        </div>
      </div>
      <div className="hidden w-40 shrink-0 items-center gap-2 sm:flex">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-inset">
          <div
            className={cn(
              "h-full rounded-full",
              trace.hasError
                ? "bg-[hsl(var(--destructive))]"
                : "bg-[hsl(var(--chart-1))]",
            )}
            style={{ width: `${widthPct}%` }}
          />
        </div>
      </div>
      <span className="w-16 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">
        {formatSpanDuration(trace.durationMs)}
      </span>
    </button>
  );
}
