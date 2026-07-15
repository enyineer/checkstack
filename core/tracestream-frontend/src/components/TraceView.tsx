import { useMemo, useState } from "react";
import { ExtensionSlot, usePluginClient } from "@checkstack/frontend-api";
import {
  BackLink,
  EmptyState,
  Skeleton,
  QueryErrorState,
  StatusBadge,
  TraceWaterfall,
  SplitPane,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetBody,
  formatSpanDuration,
  formatDateTime,
  useIsMobile,
} from "@checkstack/ui";
import { CircleAlert, MousePointerClick } from "lucide-react";
import {
  TracestreamApi,
  TraceCorrelationsSlot,
} from "@checkstack/tracestream-common";
import { toWaterfallSpans } from "../lib/waterfall-adapter";
import { SpanDetailPanel } from "./SpanDetailPanel";

export interface TraceViewProps {
  streamId: string;
  traceId: string;
  /** Return to the search results. */
  onBack: () => void;
}

/**
 * A single trace: the {@link TraceWaterfall} on the left, the selected span's
 * detail on the right (desktop) or in a Sheet (mobile). Selecting a span never
 * moves the waterfall - the SplitPane keeps the two columns independent.
 */
export function TraceView({ streamId, traceId, onBack }: TraceViewProps) {
  const client = usePluginClient(TracestreamApi);
  const isMobile = useIsMobile();
  const [selectedSpanId, setSelectedSpanId] = useState<string | null>(null);

  const { data, isLoading, isError, error, refetch } = client.getTrace.useQuery(
    { streamId, traceId },
    { enabled: !!traceId },
  );

  const waterfallSpans = useMemo(
    () => (data ? toWaterfallSpans(data.spans) : []),
    [data],
  );

  // Default the selection to the root span (first by start) once loaded.
  const effectiveSelected =
    selectedSpanId ?? data?.spans[0]?.spanId ?? null;
  const selectedSpan = data?.spans.find((s) => s.spanId === effectiveSelected);

  // Correlation context for cross-signal fillers (e.g. logstream's correlated
  // log events). Keyed on the trace-window EPOCH values, not the Date instances:
  // TanStack structural sharing does not preserve Date identity across refetches
  // (live-ingest signals invalidate this query), so keying on the Date objects
  // would mint a new context every refetch and re-render every filler despite an
  // unchanged window. Keying on the epoch ms (and rebuilding the Dates inside)
  // returns the previous context object when the window is unchanged, so the
  // memoized ExtensionSlot bails out. `lastSpanAt` is non-null on every summary,
  // so it is the trace's window end directly.
  const startMs = data?.summary.startTs.getTime();
  const endMs = data?.summary.lastSpanAt.getTime();
  const rootServiceName = data?.summary.rootServiceName ?? null;
  const correlationContext = useMemo(
    () =>
      startMs !== undefined && endMs !== undefined
        ? {
            streamId,
            traceId,
            startTs: new Date(startMs),
            endTs: new Date(endMs),
            rootServiceName: rootServiceName ?? "",
          }
        : null,
    [streamId, traceId, startMs, endMs, rootServiceName],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <BackLink onClick={onBack}>Back to search</BackLink>
        {data && (
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <span className="tabular-nums">
              {formatSpanDuration(data.summary.durationMs)}
            </span>
            <span className="tabular-nums">
              {data.summary.spanCount} spans
            </span>
            {data.summary.hasError && (
              <StatusBadge tone="error" icon={CircleAlert} label="Error" />
            )}
            <span className="hidden tabular-nums sm:inline">
              {formatDateTime(data.summary.startTs)}
            </span>
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-3" aria-busy="true">
          <Skeleton variant="chart" />
        </div>
      ) : isError ? (
        <QueryErrorState
          error={error}
          resource="trace"
          onRetry={() => void refetch()}
        />
      ) : !data || data.spans.length === 0 ? (
        <EmptyState
          icon={<MousePointerClick className="h-8 w-8" />}
          title="No spans"
          description="This trace kept only a summary - its raw spans were not retained by the sampling policy, or have aged out of retention."
        />
      ) : (
        <>
          <SplitPane
            masterWidth="1/2"
            master={
              <TraceWaterfall
                spans={waterfallSpans}
                selectedSpanId={effectiveSelected}
                onSpanClick={setSelectedSpanId}
                heightClassName="h-full max-md:h-[55vh]"
                className="h-full"
              />
            }
            detail={
              selectedSpan ? (
                <div className="rounded-[var(--radius)] border bg-card p-4">
                  <SpanDetailPanel span={selectedSpan} />
                </div>
              ) : (
                <EmptyState
                  icon={<MousePointerClick className="h-8 w-8" />}
                  title="Select a span"
                  description="Pick a span in the waterfall to see its attributes, events and status."
                />
              )
            }
          />

          {/* Mobile: the span detail opens as a sheet over the waterfall. */}
          {isMobile && (
            <Sheet
              open={selectedSpanId !== null}
              onOpenChange={(open) => {
                if (!open) setSelectedSpanId(null);
              }}
            >
              <SheetContent size="xl">
                <SheetHeader>
                  <SheetTitle>Span detail</SheetTitle>
                  <SheetDescription className="sr-only">
                    Details for the selected span
                  </SheetDescription>
                </SheetHeader>
                <SheetBody>
                  {selectedSpan && <SpanDetailPanel span={selectedSpan} />}
                </SheetBody>
              </SheetContent>
            </Sheet>
          )}

          {correlationContext && (
            <ExtensionSlot
              slot={TraceCorrelationsSlot}
              context={correlationContext}
            />
          )}
        </>
      )}
    </div>
  );
}
