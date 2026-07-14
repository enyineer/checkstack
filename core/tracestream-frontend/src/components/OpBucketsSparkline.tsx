import { useMemo } from "react";
import { usePluginClient } from "@checkstack/frontend-api";
import {
  Sparkline,
  Skeleton,
  formatNumber,
  formatSpanDuration,
} from "@checkstack/ui";
import { TracestreamApi } from "@checkstack/tracestream-common";

export interface OpBucketsSparklineProps {
  streamId: string;
  serviceName: string;
  spanName: string;
  from: Date;
  to: Date;
}

/**
 * Per-operation activity: a span-volume sparkline plus headline aggregates
 * (calls, error rate, peak p95) over the window, from `getOpBuckets`. The bucket
 * grain is picked by the backend from the window width.
 */
export function OpBucketsSparkline({
  streamId,
  serviceName,
  spanName,
  from,
  to,
}: OpBucketsSparklineProps) {
  const client = usePluginClient(TracestreamApi);
  const { data, isLoading } = client.getOpBuckets.useQuery({
    streamId,
    serviceName,
    spanName,
    from,
    to,
  });

  const stats = useMemo(() => {
    const buckets = data?.buckets ?? [];
    let spans = 0;
    let errors = 0;
    let peakP95 = 0;
    for (const b of buckets) {
      spans += b.spanCount;
      errors += b.errorCount;
      if (b.p95Ms !== null && b.p95Ms > peakP95) peakP95 = b.p95Ms;
    }
    return {
      spans,
      errorRate: spans > 0 ? errors / spans : 0,
      peakP95,
      values: buckets.map((b) => b.spanCount),
    };
  }, [data]);

  if (isLoading) return <Skeleton variant="text" className="h-8 w-full" />;

  const hasError = stats.errorRate > 0;

  return (
    <div className="flex items-center gap-4">
      <div className="min-w-0 flex-1">
        <Sparkline
          values={stats.values.length > 0 ? stats.values : [0, 0]}
          tone={hasError ? "warn" : "primary"}
          height={28}
          ariaLabel={`${spanName} span volume over time`}
        />
      </div>
      <dl className="flex shrink-0 gap-4 text-xs">
        <Stat label="Calls" value={formatNumber(stats.spans)} />
        <Stat
          label="Errors"
          value={`${(stats.errorRate * 100).toFixed(stats.errorRate < 0.01 ? 2 : 1)}%`}
          tone={hasError ? "warn" : undefined}
        />
        <Stat label="Peak p95" value={formatSpanDuration(stats.peakP95)} />
      </dl>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "warn";
}) {
  return (
    <div className="text-right">
      <dt className="text-muted-foreground">{label}</dt>
      <dd
        className={
          tone === "warn"
            ? "font-medium tabular-nums text-warning"
            : "font-medium tabular-nums text-foreground"
        }
      >
        {value}
      </dd>
    </div>
  );
}
