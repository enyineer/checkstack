import { Link } from "react-router-dom";
import { usePluginClient } from "@checkstack/frontend-api";
import { Button } from "@checkstack/ui";
import { Waypoints } from "lucide-react";
import { TracestreamApi, buildViewTraceHref } from "@checkstack/tracestream-common";

/**
 * Compact "View trace" action for a single trace id, shared by the log-event
 * and health-check-run fillers. Resolves the readable streams the id appears in
 * via `findTraceById` (RLAC-filtered server-side) and self-hides while loading
 * or when the id belongs to no readable/ingested trace, so the slot host never
 * shows an empty control. A single match renders one button; multiple matches
 * (the same id ingested into several readable streams) render one button per
 * stream, labelled with the stream name.
 *
 * The caller MUST only mount this once it knows the id is present (the fillers
 * gate on `event.traceId` / `extractRunTraceIds` first), so no query runs for a
 * row that carries no trace context.
 *
 * The per-trace `findTraceById` query is additionally gated behind a cheap,
 * long-cached "does the caller see any trace streams at all" probe
 * (`listStreamsForPicker`). With `traceparent` default-on, every HTTP run and
 * every trace-carrying log event would otherwise fire 1-3 lookups that can NEVER
 * match in an installation with no trace streams (and prev/next run navigation
 * multiplies that across distinct trace ids). The probe is one shared cache
 * entry across all fillers, so the per-trace lookups only run where a trace
 * stream actually exists.
 */
const STREAM_PROBE_STALE_MS = 5 * 60 * 1000;

export function ViewTraceLink({ traceId }: { traceId: string }) {
  const client = usePluginClient(TracestreamApi);
  // Shared, long-cached gate: no readable/creatable trace stream => no match is
  // ever possible, so skip the per-trace lookup entirely.
  const { data: pickerStreams } = client.listStreamsForPicker.useQuery(
    {},
    { staleTime: STREAM_PROBE_STALE_MS },
  );
  const hasAnyStreams = (pickerStreams?.length ?? 0) > 0;

  const { data } = client.findTraceById.useQuery(
    { traceId },
    { enabled: hasAnyStreams },
  );

  const matches = data?.matches ?? [];
  if (matches.length === 0) return null;

  if (matches.length === 1) {
    const match = matches[0];
    return (
      <Button asChild variant="outline" size="sm">
        <Link to={buildViewTraceHref({ streamId: match.id, traceId })}>
          <Waypoints className="mr-1.5 h-4 w-4" />
          View trace
        </Link>
      </Button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted-foreground">View trace in</span>
      {matches.map((match) => (
        <Button key={match.id} asChild variant="outline" size="sm">
          <Link to={buildViewTraceHref({ streamId: match.id, traceId })}>
            <Waypoints className="mr-1.5 h-4 w-4" />
            {match.streamName}
          </Link>
        </Button>
      ))}
    </div>
  );
}
