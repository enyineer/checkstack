import { useMemo } from "react";
import { Link } from "react-router-dom";
import { usePluginClient } from "@checkstack/frontend-api";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  StatusBadge,
  Skeleton,
  formatDateTime,
} from "@checkstack/ui";
import {
  LogstreamApi,
  type FindEventsByTraceIdMatch,
} from "@checkstack/logstream-common";
import { ArrowUpRight } from "lucide-react";
import { buildExploreHref } from "../lib/explore-link";
import {
  severityBandIcon,
  severityBandLabel,
  severityBandToTone,
} from "../lib/severity-tone";

/** Pad (ms) applied to the trace's span window before the log lookup - a
 * correlated line can be stamped slightly outside the span window (clock skew,
 * late flush). Mirrors the slot doc's guidance to widen before querying. */
const WINDOW_PAD_MS = 5 * 60 * 1000;

export interface CorrelatedLogsProps {
  /** W3C trace id shared with the open trace. */
  traceId: string;
  /** Start of the trace's span window. */
  startTs: Date;
  /** End of the trace's span window. */
  endTs: Date;
}

/** One stream's correlated lines: a header that links to Explore + compact rows. */
function StreamGroup({
  match,
  traceId,
  from,
  to,
}: {
  match: FindEventsByTraceIdMatch;
  traceId: string;
  from: Date;
  to: Date;
}) {
  return (
    <div className="overflow-hidden rounded-md border bg-surface-inset">
      <div className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
        <span className="min-w-0 truncate text-sm font-medium text-foreground">
          {match.streamName}
        </span>
        <Link
          to={buildExploreHref({ streamId: match.id, traceId, from, to })}
          className="inline-flex shrink-0 items-center gap-1 text-xs text-primary transition-colors hover:underline"
        >
          Open in Explore
          <ArrowUpRight className="size-3" aria-hidden />
        </Link>
      </div>
      <ul className="divide-y divide-border/40">
        {match.events.map((event) => (
          <li key={event.id} className="flex items-start gap-2 px-3 py-1.5">
            <StatusBadge
              tone={severityBandToTone(event.band)}
              icon={severityBandIcon(event.band)}
              label={severityBandLabel(event.band)}
              className="mt-px"
            />
            <time className="mt-0.5 shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
              {formatDateTime(event.ts)}
            </time>
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">
              {event.body}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Trace-view correlations filler: the log lines sharing the open trace's id,
 * grouped per stream. Queries {@link LogstreamApi.findEventsByTraceId} over the
 * trace's (padded) span window; the backend post-filters the groups to the
 * caller's readable streams. Self-hides (renders null) when the trace has no
 * correlated logs, per the {@link TraceCorrelationsSlot} contract - the trace
 * view mounts every filler.
 */
export function CorrelatedLogs({ traceId, startTs, endTs }: CorrelatedLogsProps) {
  const client = usePluginClient(LogstreamApi);

  // Memoize the padded window so the query key stays referentially stable
  // across the trace view's re-renders (see `.claude/rules/performance.md`).
  const { from, to } = useMemo(
    () => ({
      from: new Date(startTs.getTime() - WINDOW_PAD_MS),
      to: new Date(endTs.getTime() + WINDOW_PAD_MS),
    }),
    [startTs, endTs],
  );

  const { data, isLoading } = client.findEventsByTraceId.useQuery({
    traceId,
    from,
    to,
  });

  if (isLoading) {
    return (
      <div className="space-y-2" aria-busy="true" aria-label="Loading correlated logs">
        <Skeleton variant="row" />
        <Skeleton variant="row" />
      </div>
    );
  }

  const matches = data?.matches ?? [];
  // Only groups that actually carry lines; a stream with an empty page is noise.
  const nonEmpty = matches.filter((match) => match.events.length > 0);
  if (nonEmpty.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Correlated logs</CardTitle>
        <CardDescription>
          Log lines sharing this trace id, grouped by stream.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {nonEmpty.map((match) => (
          <StreamGroup
            key={match.id}
            match={match}
            traceId={traceId}
            from={from}
            to={to}
          />
        ))}
      </CardContent>
    </Card>
  );
}
