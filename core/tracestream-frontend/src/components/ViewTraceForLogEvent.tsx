import type { LogEvent } from "@checkstack/logstream-common";
import { ViewTraceLink } from "./ViewTraceLink";

/**
 * `LogEventDetailSlot` filler: a "View trace" jump for an expanded log event
 * that carries a `traceId`. Gates on the already-loaded event before mounting
 * {@link ViewTraceLink}, so an event with no trace context renders null with no
 * query (the slot host mounts this for every expanded row).
 */
export function ViewTraceForLogEvent({ event }: { event: LogEvent }) {
  if (!event.traceId) return null;
  return <ViewTraceLink traceId={event.traceId} />;
}
