import {
  extractRunTraceIds,
  type HealthCheckRun,
} from "@checkstack/healthcheck-common";
import { ViewTraceLink } from "./ViewTraceLink";

/**
 * `RunDetailExtrasSlot` filler: a "View trace" jump for a health-check run whose
 * collectors recorded a trace id (e.g. the HTTP collector's W3C `traceparent`).
 * Reads the ids via `extractRunTraceIds` and renders nothing (no query) when the
 * run carries none. A multi-collector run may record several ids; we render one
 * action per id, capped at the first three to bound the fan-out (one query per
 * id). Each {@link ViewTraceLink} self-hides when its id resolves to no readable
 * trace, so a run with ids but no readable matches shows nothing.
 */
export function ViewTraceForRun({ run }: { run: HealthCheckRun }) {
  const traceIds = extractRunTraceIds({ run }).slice(0, 3);
  if (traceIds.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {traceIds.map((traceId) => (
        <ViewTraceLink key={traceId} traceId={traceId} />
      ))}
    </div>
  );
}
