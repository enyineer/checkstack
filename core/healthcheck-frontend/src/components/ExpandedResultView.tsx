/**
 * ExpandedResultView - run-detail status, response-time metric strip, and a
 * per-run timing breakdown for a single health check run.
 *
 * Reskinned onto the design-system language (`reviews/design/pro-console`
 * timing waterfall + `adaptive-saas` metric strip): a token-driven metric strip
 * (status / total latency / connection) sits above a {@link RequestWaterfall}.
 *
 * Timing honesty: when the transport exposes a granular breakdown
 * (`metadata.timings` - DNS / connect / TLS / wait / transfer, or `processing`
 * for non-HTTP operations) the waterfall shows exactly those measured phases in
 * transport order. When it does not (old runs, single-phase strategies) it
 * falls back to the coarse Connection + Processing split derived from
 * `connectionTimeMs` and the total. We never fabricate a phase we did not
 * measure. The phase-builder lives in `@checkstack/healthcheck-common`
 * (`buildRunTimingPhases`) so the fallback rules are unit-tested once.
 */

import { RequestWaterfall, cn, type WaterfallPhase } from "@checkstack/ui";
import {
  buildRunTimingPhases,
  hasGranularTimings,
  RunTimingsSchema,
  type RunTimings,
} from "@checkstack/healthcheck-common";

interface ExpandedResultViewProps {
  result: Record<string, unknown>;
}

const STATUS_TONE: Record<string, string> = {
  healthy: "text-[hsl(var(--status-ok))]",
  degraded: "text-[hsl(var(--status-warn))]",
  unhealthy: "text-[hsl(var(--status-down))]",
};

function Metric({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div className="rounded-[var(--d-card-r)] bg-[hsl(var(--surface-inset))] px-3 py-2 min-w-0">
      <p className="text-xs text-muted-foreground truncate">{label}</p>
      <p className={cn("text-sm font-semibold tabular-nums truncate", valueClassName)}>
        {value}
      </p>
    </div>
  );
}

/** Safely parse the optional structured timings off a run's metadata. */
function parseTimings(metadata: Record<string, unknown> | undefined): RunTimings | undefined {
  if (!metadata || metadata.timings === undefined) return undefined;
  const parsed = RunTimingsSchema.safeParse(metadata.timings);
  return parsed.success ? parsed.data : undefined;
}

/**
 * Displays a single run's status, response-time metric strip, and a timing
 * waterfall - granular when the transport measured sub-phases, coarse
 * Connection/Processing otherwise.
 */
export function ExpandedResultView({ result }: ExpandedResultViewProps) {
  const status = String(result.status);
  const latencyMs =
    typeof result.latencyMs === "number" ? result.latencyMs : undefined;
  const metadata = result.metadata as Record<string, unknown> | undefined;
  const connectionTimeMs =
    typeof metadata?.connectionTimeMs === "number"
      ? metadata.connectionTimeMs
      : undefined;
  const timings = parseTimings(metadata);

  // Build the waterfall GENERICALLY from the structured timings, falling back
  // to the coarse Connection + Processing split when no granular timings exist.
  const phases: WaterfallPhase[] = buildRunTimingPhases({
    timings,
    connectionTimeMs,
    latencyMs,
  });
  const granular = hasGranularTimings(timings);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Metric
          label="Status"
          value={status}
          valueClassName={cn("capitalize", STATUS_TONE[status])}
        />
        <Metric
          label="Response time"
          value={latencyMs === undefined ? "—" : `${latencyMs} ms`}
        />
        {connectionTimeMs !== undefined && (
          <Metric label="Connection" value={`${connectionTimeMs} ms`} />
        )}
      </div>

      {phases.length > 0 && (
        <div className="rounded-[var(--d-card-r)] border bg-[hsl(var(--surface-2))] p-3 space-y-2">
          <p className="text-xs font-medium text-muted-foreground">
            Timing breakdown
          </p>
          <RequestWaterfall phases={phases} />
          <p className="text-[11px] text-muted-foreground">
            {granular
              ? "Phases reflect this run's transport timing. Wait and transfer are measured on the request; connection-setup phases may be sampled alongside it."
              : "Only connection and processing time were recorded for this run; finer DNS / TLS / transfer phases were not captured by this transport."}
          </p>
        </div>
      )}
    </div>
  );
}
