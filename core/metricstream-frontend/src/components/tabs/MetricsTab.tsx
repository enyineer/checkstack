import { MetricsBrowser } from "../MetricsBrowser";

export interface MetricsTabProps {
  streamId: string;
}

/** Metrics tab: a searchable browser over the stream's registered metric names. */
export function MetricsTab({ streamId }: MetricsTabProps) {
  return <MetricsBrowser streamId={streamId} />;
}
