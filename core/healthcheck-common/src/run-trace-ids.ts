import type { HealthCheckRun } from "./schemas";

/**
 * Collect the trace ids a run's collectors recorded, in collector-entry
 * order, deduplicated. By convention a collector that emits a trace context
 * (e.g. the HTTP request collector's W3C `traceparent` header) stores the
 * generated trace id as a string `traceId` field on its result, which lands
 * at `run.result.metadata.collectors[<entryId>].traceId`. This helper owns
 * that shape so consumers (like a "View trace" slot filler) never reach into
 * the run-result layout themselves.
 */
export function extractRunTraceIds({ run }: { run: HealthCheckRun }): string[] {
  const metadata = asRecord(run.result["metadata"]);
  const collectors = asRecord(metadata?.["collectors"]);
  if (!collectors) return [];
  const traceIds: string[] = [];
  for (const collectorResult of Object.values(collectors)) {
    const traceId = asRecord(collectorResult)?.["traceId"];
    if (
      typeof traceId === "string" &&
      traceId.length > 0 &&
      !traceIds.includes(traceId)
    ) {
      traceIds.push(traceId);
    }
  }
  return traceIds;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  // The cast is the standard narrowing for a checked plain object: TS cannot
  // narrow `object` to an index-signature type without one.
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
