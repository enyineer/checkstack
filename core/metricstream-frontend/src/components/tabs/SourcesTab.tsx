import { type MetricStream } from "@checkstack/metricstream-common";
import { StreamSourcesSection } from "@checkstack/telemetry-frontend";

export interface SourcesTabProps {
  stream: MetricStream;
}

/**
 * Sources tab: the telemetry platform's sources section for the `metrics`
 * signal. Push-endpoint snippets and per-instance token management (mint /
 * rotate / disable) are owned by the platform now - a `metricstream.push` source
 * instance holds the token, so there is no plugin-local token UI to render.
 */
export function SourcesTab({ stream }: SourcesTabProps) {
  return (
    <div className="space-y-6">
      <StreamSourcesSection signal="metrics" streamId={stream.id} />
    </div>
  );
}
