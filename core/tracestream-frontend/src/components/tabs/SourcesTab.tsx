import { type TraceStream } from "@checkstack/tracestream-common";
import { StreamSourcesSection } from "@checkstack/telemetry-frontend";

export interface SourcesTabProps {
  stream: TraceStream;
}

/**
 * Sources tab: the telemetry platform's sources section for the `traces`
 * signal. Push-endpoint snippets and per-instance token management (mint /
 * rotate / disable) are owned by the platform now - a `tracestream.push` source
 * instance holds the token, so there is no plugin-local token UI to render.
 */
export function SourcesTab({ stream }: SourcesTabProps) {
  return (
    <div className="space-y-6">
      <StreamSourcesSection signal="traces" streamId={stream.id} />
    </div>
  );
}
