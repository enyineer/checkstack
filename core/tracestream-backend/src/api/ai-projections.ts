import { z } from "zod";
import {
  deferredProjectionExecute,
  type AiToolProjectionExtensionPoint,
} from "@checkstack/ai-backend";
import {
  pluginMetadata,
  tracestreamContract,
  TraceSummarySchema,
} from "@checkstack/tracestream-common";
import {
  TelemetrySpanKindSchema,
  TelemetrySpanStatusCodeSchema,
} from "@checkstack/telemetry-common";

/**
 * Model-facing AI tool projections for tracestream (see
 * `aiToolProjectionExtensionPoint.expose`). The chat/MCP read-loop re-enters the
 * real procedure AS the principal and gets the FULL output (authz + audit
 * unchanged); these mappers only trim the shape that enters the model's context
 * window. Every projection is `effect: "read"` and defers its own `execute`
 * (`deferredProjectionExecute`) - the transport routes it, never a service call.
 *
 * Slimming rationale:
 * - `searchTraces` rows are already lean summaries; we drop the two fields the
 *   model never reasons over (`retained`, `lastSpanAt`) AND the opaque
 *   `nextCursor` (a serialized keyset handle the model cannot use - it only
 *   wastes context every page).
 * - `getTrace` returns the FULL waterfall - every span with its attributes,
 *   events, links, resourceAttributes and timestamps. Those are UNBOUNDED
 *   records; a full trace blows the context. We keep the summary verbatim and
 *   reduce each span to the identity + shape fields the model needs to reason
 *   about the call tree.
 */

// ===========================================================================
// searchTraces (light): drop retained / lastSpanAt from each summary row
// ===========================================================================

const SearchTracesResultShape = z.object({
  traces: z.array(TraceSummarySchema),
});

/** A search summary trimmed to what the model reasons over. */
interface LeanTraceSummary {
  traceId: string;
  rootServiceName: string | null;
  rootSpanName: string | null;
  startTs: string;
  durationMs: number;
  spanCount: number;
  errorSpanCount: number;
  hasError: boolean;
}

export function projectSearchTracesForModel(output: unknown): unknown {
  const parsed = SearchTracesResultShape.safeParse(output);
  if (!parsed.success) return output;
  const { traces } = parsed.data;
  const lean: LeanTraceSummary[] = traces.map((t) => ({
    traceId: t.traceId,
    rootServiceName: t.rootServiceName,
    rootSpanName: t.rootSpanName,
    startTs: t.startTs.toISOString(),
    durationMs: t.durationMs,
    spanCount: t.spanCount,
    errorSpanCount: t.errorSpanCount,
    hasError: t.hasError,
  }));
  return { traces: lean, returned: lean.length };
}

// ===========================================================================
// getTrace (mandatory slim): summary verbatim, spans reduced to identity+shape
// ===========================================================================

/** The span fields we keep; everything else (attrs/events/links/ts) is dropped. */
const LeanSpanShape = z.object({
  spanId: z.string(),
  parentSpanId: z.string().nullable(),
  name: z.string(),
  serviceName: z.string().nullable(),
  kind: TelemetrySpanKindSchema,
  durationMs: z.number(),
  statusCode: TelemetrySpanStatusCodeSchema,
});

const GetTraceResultShape = z.object({
  summary: TraceSummarySchema,
  spans: z.array(LeanSpanShape.passthrough()),
});

interface LeanSpan {
  spanId: string;
  parentSpanId: string | null;
  name: string;
  serviceName: string | null;
  kind: z.infer<typeof TelemetrySpanKindSchema>;
  durationMs: number;
  statusCode: z.infer<typeof TelemetrySpanStatusCodeSchema>;
}

export function projectGetTraceForModel(output: unknown): unknown {
  const parsed = GetTraceResultShape.safeParse(output);
  // Defensive: on any shape mismatch return unchanged - the generic clamp is the
  // backstop, so a mismatch never crashes the read (it just sends the full shape).
  if (!parsed.success) return output;
  const { summary, spans } = parsed.data;
  const leanSpans: LeanSpan[] = spans.map((s) => ({
    spanId: s.spanId,
    parentSpanId: s.parentSpanId,
    name: s.name,
    serviceName: s.serviceName,
    kind: s.kind,
    durationMs: s.durationMs,
    statusCode: s.statusCode,
  }));
  return { summary, spans: leanSpans, spanCount: leanSpans.length };
}

// ===========================================================================
// REGISTRATION
// ===========================================================================

/**
 * Expose tracestream's read procedures as model-facing AI tools. Owned here (not
 * in ai-backend); each projected read tool is routed by the transport (MCP /
 * chat) AS the principal, so the source procedure's own `tracestream.stream.read`
 * gate applies. `deferredProjectionExecute` is the fail-closed net.
 */
export function registerTracestreamAiProjections(
  projection: AiToolProjectionExtensionPoint,
): void {
  // Trace search: a lean list of trace summaries. Steer the model to the
  // aggregate tool for volume/latency questions instead of paging raw rows.
  projection.expose({
    procedure: tracestreamContract.searchTraces,
    sourcePluginMetadata: pluginMetadata,
    procedureKey: "searchTraces",
    name: "tracestream.searchTraces",
    description:
      "Search a trace stream for individual traces in a time window, " +
      "filterable by `serviceName`, `spanName`, error/ok `status`, and " +
      "duration bounds. Returns lean per-trace summaries (root service/op, " +
      "duration, span + error counts). Requires a `streamId` (list streams " +
      "first). For 'how slow / how often / error rate over a window' " +
      "questions, PREFER tracestream.serviceStats - it returns compact " +
      "aggregates, not raw rows. Read-only.",
    effect: "read",
    execute: deferredProjectionExecute,
    projectResult: projectSearchTracesForModel,
  });

  // One trace's summary + its waterfall, SLIMMED: full spans carry unbounded
  // attribute/event/link records that would blow the context window.
  projection.expose({
    procedure: tracestreamContract.getTrace,
    sourcePluginMetadata: pluginMetadata,
    procedureKey: "getTrace",
    name: "tracestream.getTraceSummary",
    description:
      "Fetch ONE trace's summary and its span waterfall, given a `streamId` " +
      "and `traceId` (find candidates with tracestream.searchTraces). Each " +
      "span is reduced to its identity and shape (name, service, kind, " +
      "duration, status, span/parent ids) so you can reason about the call " +
      "tree and find the slow or failing span - raw attributes, events and " +
      "links are omitted to keep the trace compact. Read-only.",
    effect: "read",
    execute: deferredProjectionExecute,
    projectResult: projectGetTraceForModel,
  });

  // Windowed operation aggregates (counts, error counts, latency incl. p95) -
  // the compact way to answer volume/latency questions. Output is already
  // bounded numeric buckets, so no projectResult.
  projection.expose({
    procedure: tracestreamContract.getOpBuckets,
    sourcePluginMetadata: pluginMetadata,
    procedureKey: "getOpBuckets",
    name: "tracestream.serviceStats",
    description:
      "Summarize a trace stream's operation latency and volume over a window: " +
      "per-bucket span counts, error counts, and latency stats (sum/min/max " +
      "and p95). Filter by `serviceName` and/or `spanName`; omit `grain` to " +
      "auto-pick minute vs hour from the window width. PREFER THIS over " +
      "tracestream.searchTraces for any 'how slow / how often / error rate / " +
      "latency trend over the last N minutes or hours' question - it returns " +
      "compact aggregates, not raw traces. Requires a `streamId`. Read-only.",
    effect: "read",
    execute: deferredProjectionExecute,
  });

  // The tiny service catalog for a stream (id + cardinality); lets the model
  // resolve a service name before drilling into serviceStats / searchTraces.
  projection.expose({
    procedure: tracestreamContract.listServices,
    sourcePluginMetadata: pluginMetadata,
    procedureKey: "listServices",
    name: "tracestream.listServices",
    description:
      "List the services seen in a trace stream (given a `streamId`), with " +
      "each service's operation cardinality and last-seen time. Use this to " +
      "discover which services report traces before querying " +
      "tracestream.serviceStats or tracestream.searchTraces. Read-only.",
    effect: "read",
    execute: deferredProjectionExecute,
  });
}
