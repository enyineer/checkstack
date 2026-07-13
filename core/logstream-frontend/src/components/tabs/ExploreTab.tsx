import { useEffect, useMemo, useState } from "react";
import { useApi, usePluginClient, accessApiRef } from "@checkstack/frontend-api";
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
  Skeleton,
  EmptyState,
  QueryErrorState,
  cn,
  type DateRange,
} from "@checkstack/ui";
import {
  LogstreamApi,
  SEVERITY_BANDS,
  type EventCursor,
  type LogEvent,
} from "@checkstack/logstream-common";
import { Search, X } from "lucide-react";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import {
  hasActiveFilters,
  mergeOlderEvents,
  toggleBand,
  toSearchInput,
  type ExploreFilters,
} from "../../lib/explore-filters";
import {
  severityBandIcon,
  severityBandLabel,
  severityBandToTone,
} from "../../lib/severity-tone";
import { LogEventRow } from "../LogEventRow";
import { PatternOccurrencesChart } from "../PatternOccurrencesChart";
import { PatternBuilderDialog } from "../PatternBuilderDialog";

const PAGE_LIMIT = 100;

function defaultRange(): DateRange {
  const endDate = new Date();
  return { startDate: new Date(endDate.getTime() - 24 * 60 * 60 * 1000), endDate };
}

export interface ExploreTabProps {
  streamId: string;
  /** Initial deep-link filters (from the overview/patterns tabs). */
  initialPatternId?: string | null;
  initialFrom?: Date | null;
  initialTo?: Date | null;
}

/**
 * Explore tab: a filterable, keyset-paginated log viewer. The newest page is a
 * live `useQuery` (auto-invalidated by same-plugin signals, keep-previous so a
 * refresh never yanks scroll); older pages are fetched imperatively and merged
 * with de-duplication.
 */
export function ExploreTab({
  streamId,
  initialPatternId,
  initialFrom,
  initialTo,
}: ExploreTabProps) {
  const client = usePluginClient(LogstreamApi);
  const accessApi = useApi(accessApiRef);

  // The pattern-authoring verdict, resolved ONCE for the whole list (never a
  // per-row hook - rows are virtualized, see `.claude/rules/performance.md`).
  const { allowed: canCreatePattern } = accessApi.useProcedureAccess(
    LogstreamApi.contract.createPattern,
    { streamId },
  );
  const [builderOpen, setBuilderOpen] = useState(false);
  const [builderSeed, setBuilderSeed] = useState<string | undefined>();

  const [filters, setFilters] = useState<ExploreFilters>(() => ({
    text: "",
    severityBands: [],
    patternId: initialPatternId ?? null,
    from: initialFrom ?? null,
    to: initialTo ?? null,
  }));
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [olderPages, setOlderPages] = useState<LogEvent[]>([]);
  const [nextOlderCursor, setNextOlderCursor] = useState<EventCursor | null>(
    null,
  );
  const [loadingOlder, setLoadingOlder] = useState(false);

  const debouncedText = useDebouncedValue(filters.text, 300);
  const effectiveFilters: ExploreFilters = { ...filters, text: debouncedText };

  const searchInput = toSearchInput({
    streamId,
    filters: effectiveFilters,
    limit: PAGE_LIMIT,
  });

  const {
    data: firstPage,
    isLoading,
    isError,
    error,
    isFetching,
    refetch,
  } = client.searchEvents.useQuery(searchInput, {
    placeholderData: (prev) => prev,
  });

  const { data: patterns } = client.listPatterns.useQuery({
    streamId,
    limit: 500,
  });
  const patternTemplates = useMemo(
    () => new Map((patterns ?? []).map((p) => [p.id, p.template])),
    [patterns],
  );

  // Reset accumulated older pages whenever the query facets change.
  const facetKey = JSON.stringify({
    text: debouncedText.trim(),
    severityBands: filters.severityBands,
    patternId: filters.patternId,
    from: filters.from?.toISOString() ?? null,
    to: filters.to?.toISOString() ?? null,
  });
  useEffect(() => {
    setOlderPages([]);
    setNextOlderCursor(null);
    setExpandedId(null);
  }, [facetKey]);

  const events = useMemo(
    () =>
      mergeOlderEvents({
        current: firstPage?.events ?? [],
        incoming: olderPages,
      }),
    [firstPage, olderPages],
  );

  const baseCursor = firstPage?.nextCursor ?? null;
  const effectiveCursor = olderPages.length > 0 ? nextOlderCursor : baseCursor;
  const hasMore = effectiveCursor !== null;

  const loadOlder = async () => {
    if (loadingOlder || !effectiveCursor) return;
    setLoadingOlder(true);
    try {
      const res = await client.searchEvents.call(
        toSearchInput({
          streamId,
          filters: effectiveFilters,
          cursor: effectiveCursor,
          limit: PAGE_LIMIT,
        }),
      );
      setOlderPages((prev) =>
        mergeOlderEvents({ current: prev, incoming: res.events }),
      );
      setNextOlderCursor(res.nextCursor);
    } finally {
      setLoadingOlder(false);
    }
  };

  const rangeValue: DateRange =
    filters.from && filters.to
      ? { startDate: filters.from, endDate: filters.to }
      : defaultRange();
  const timeFiltered = filters.from !== null || filters.to !== null;

  const filterToPattern = (patternId: string) =>
    setFilters((f) => ({ ...f, patternId }));

  // Seed the builder from the clicked line. A classified line's pattern template
  // is the masked source of truth; an as-yet-unclassified line is masked
  // server-side (the exact ingest masker) so its chips can't drift, falling back
  // to the raw body only if masking fails (the live preview then flags it).
  const openBuilderForEvent = async (event: LogEvent) => {
    let seed = event.patternId
      ? patternTemplates.get(event.patternId)
      : undefined;
    if (!seed) {
      try {
        const { template } = await client.maskLine.call({
          streamId,
          body: event.body.slice(0, 32_768),
        });
        seed = template;
      } catch {
        seed = event.body;
      }
    }
    setBuilderSeed(seed);
    setBuilderOpen(true);
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Toolbar: two structured rows so the search field never gets squeezed
          out by the (many) fixed-width controls. Row 1: search + time range.
          Row 2: severity pills + pattern filter + clear. */}
      <div className="flex flex-col gap-3 rounded-lg border bg-card p-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={filters.text}
              onChange={(e) =>
                setFilters((f) => ({ ...f, text: e.target.value }))
              }
              placeholder="Search log bodies..."
              className="pl-8"
              aria-label="Search log bodies"
            />
          </div>
          <DateRangeFilter
            value={rangeValue}
            onChange={(r) =>
              setFilters((f) => ({ ...f, from: r.startDate, to: r.endDate }))
            }
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap items-center gap-1">
          {SEVERITY_BANDS.map((band) => {
            const active = filters.severityBands.includes(band);
            const Icon = severityBandIcon(band);
            const tone = severityBandToTone(band);
            return (
              <button
                key={band}
                type="button"
                aria-pressed={active}
                onClick={() =>
                  setFilters((f) => ({
                    ...f,
                    severityBands: toggleBand(f.severityBands, band),
                  }))
                }
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs font-medium transition-colors",
                  active
                    ? tone === "error"
                      ? "border-destructive/40 bg-destructive/10 text-destructive"
                      : tone === "warn"
                        ? "border-warning/40 bg-warning/10 text-warning"
                        : tone === "info"
                          ? "border-info/40 bg-info/10 text-info"
                          : "border-border bg-secondary text-secondary-foreground"
                    : "border-border bg-card text-muted-foreground hover:bg-surface-inset",
                )}
              >
                <Icon className="size-3" aria-hidden />
                {severityBandLabel(band)}
              </button>
            );
          })}
          </div>

          <Select
            value={filters.patternId ?? "all"}
            onValueChange={(v) =>
              setFilters((f) => ({ ...f, patternId: v === "all" ? null : v }))
            }
          >
            <SelectTrigger
              className="w-full max-w-full truncate sm:w-64"
              aria-label="Filter by pattern"
            >
              <SelectValue placeholder="All patterns" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All patterns</SelectItem>
              {(patterns ?? []).map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  <span className="font-mono text-xs">{p.template}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {(hasActiveFilters(filters) || timeFiltered) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                setFilters({
                  text: "",
                  severityBands: [],
                  patternId: null,
                  from: null,
                  to: null,
                })
              }
            >
              <X className="size-4" />
              Clear
            </Button>
          )}
        </div>
      </div>

      {/* Occurrences-over-time for the focused pattern (single lightweight
          query; DateRangeFilter-driven via the same range as the results). */}
      {filters.patternId && (
        <PatternOccurrencesChart
          streamId={streamId}
          patternId={filters.patternId}
          from={rangeValue.startDate}
          to={rangeValue.endDate}
        />
      )}

      {/* Results */}
      {isLoading ? (
        <div className="space-y-2" aria-busy="true">
          <Skeleton variant="row" />
          <Skeleton variant="row" />
          <Skeleton variant="row" />
        </div>
      ) : isError ? (
        <QueryErrorState
          error={error}
          resource="logs"
          onRetry={() => void refetch()}
        />
      ) : events.length === 0 ? (
        <EmptyState
          icon={<Search className="h-8 w-8" />}
          title="No matching logs"
          description="No log lines match these filters in the selected range. Loosen a filter or widen the time range."
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
              items={events}
              getKey={({ item }) => item.id}
              estimateSize={({ item }) =>
                expandedId === item.id ? 240 : 34
              }
              className="h-[60vh]"
              renderItem={({ item }) => (
                <LogEventRow
                  event={item}
                  expanded={expandedId === item.id}
                  onToggle={() =>
                    setExpandedId((id) => (id === item.id ? null : item.id))
                  }
                  patternTemplate={
                    item.patternId
                      ? patternTemplates.get(item.patternId)
                      : undefined
                  }
                  onFilterPattern={filterToPattern}
                  canCreatePattern={canCreatePattern}
                  onCreatePattern={() => void openBuilderForEvent(item)}
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

      <PatternBuilderDialog
        streamId={streamId}
        open={builderOpen}
        onOpenChange={setBuilderOpen}
        initialTemplate={builderSeed}
        maskLine={(body) =>
          client.maskLine.call({ streamId, body }).then((r) => r.template)
        }
      />
    </div>
  );
}
