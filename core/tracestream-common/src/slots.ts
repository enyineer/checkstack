import { createSlot } from "@checkstack/frontend-api";

/**
 * Slot on the trace detail view (below the waterfall) for OTHER signals to
 * surface data correlated with the open trace - e.g. logstream-frontend
 * contributes the log events sharing the trace id. Fillers MUST self-hide
 * (render null) when they find nothing; the host mounts every filler for
 * every open trace.
 *
 * The window bounds are the trace's own span window (first span start / last
 * observed span); fillers should pad it before querying, since correlated
 * records can be timestamped slightly outside it (clock skew, late flush).
 * All context values must be referentially stable across renders (see
 * `.claude/rules/performance.md`) - the host memoizes the context object.
 *
 * @example
 * // In another plugin's frontend
 * extensions: [
 *   createSlotExtension(TraceCorrelationsSlot, {
 *     id: "my-plugin.trace-correlations",
 *     component: ({ traceId, startTs, endTs }) => (
 *       <MyCorrelatedRecords traceId={traceId} from={startTs} to={endTs} />
 *     ),
 *   }),
 * ]
 */
export const TraceCorrelationsSlot = createSlot<{
  /** Trace stream the trace was opened from. */
  streamId: string;
  /** W3C trace id (32 lowercase hex chars). */
  traceId: string;
  /** Start of the trace's span window. */
  startTs: Date;
  /** End of the trace's span window (last observed span). */
  endTs: Date;
  /** Service name of the trace's root span. */
  rootServiceName: string;
}>("plugin.tracestream.trace-correlations");
