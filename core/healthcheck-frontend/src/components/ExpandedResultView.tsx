/**
 * ExpandedResultView - run-detail status, response-time metric strip, and a
 * connection/processing timing breakdown for a single health check run.
 *
 * Reskinned onto the design-system language (`reviews/design/pro-console`
 * timing waterfall + `adaptive-saas` metric strip): a token-driven metric strip
 * (status / total latency / connection) sits above a {@link RequestWaterfall}.
 *
 * Honesty note: a single run only records total `latencyMs` and an optional
 * `metadata.connectionTimeMs`. The platform does NOT capture granular DNS / TCP
 * / TLS / wait / transfer phases, so the waterfall renders only the two phases
 * we actually have — Connection and Processing (total minus connection) — and
 * is omitted entirely when no connection time was recorded. We never fabricate
 * phases we did not measure.
 */

import { RequestWaterfall, cn, type WaterfallPhase } from "@checkstack/ui";

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

/**
 * Displays a single run's status, response-time metric strip, and an honest
 * connection/processing timing waterfall.
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

  // Only the two phases we actually measure. Processing = total - connection,
  // clamped at zero (timing skew can make connection >= total).
  const phases: WaterfallPhase[] =
    latencyMs !== undefined && connectionTimeMs !== undefined
      ? [
          {
            id: "connection",
            label: "Connection",
            durationMs: Math.min(connectionTimeMs, latencyMs),
          },
          {
            id: "processing",
            label: "Processing",
            durationMs: Math.max(0, latencyMs - connectionTimeMs),
          },
        ]
      : [];

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
            Only connection and processing time are recorded per run; finer DNS
            / TLS / transfer phases are not captured.
          </p>
        </div>
      )}
    </div>
  );
}
