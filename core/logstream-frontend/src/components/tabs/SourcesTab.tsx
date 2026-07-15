import { type LogStream } from "@checkstack/logstream-common";
import { StreamSourcesSection } from "@checkstack/telemetry-frontend";

export interface SourcesTabProps {
  stream: LogStream;
}

/**
 * Sources tab: the telemetry platform's sources section for the `logs` signal.
 * Push-endpoint snippets and per-instance token management (mint / rotate /
 * disable) are owned by the platform now - a `logstream.push` source instance
 * holds the token, so there is no plugin-local token UI to render.
 */
export function SourcesTab({ stream }: SourcesTabProps) {
  return (
    <div className="space-y-6">
      <StreamSourcesSection signal="logs" streamId={stream.id} />
    </div>
  );
}
