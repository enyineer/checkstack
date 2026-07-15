import { createSlot } from "@checkstack/frontend-api";
import type { LogEvent } from "./schemas";

/**
 * Slot inside the EXPANDED log-event row (Explore tab detail block). Fillers
 * add per-event actions or context - e.g. tracestream-frontend contributes a
 * "View trace" jump when the event carries a `traceId`. Fillers MUST
 * self-hide (render null) when they have nothing to offer for the event;
 * the host mounts every filler for every expanded event.
 *
 * The `event` context value is the row's already-loaded {@link LogEvent}
 * (referentially stable - it comes straight from the query cache), so
 * fillers can gate on `event.traceId` / `event.spanId` without fetching.
 *
 * @example
 * // In another plugin's frontend
 * extensions: [
 *   createSlotExtension(LogEventDetailSlot, {
 *     id: "my-plugin.log-event-detail",
 *     component: ({ event }) =>
 *       event.traceId ? <MyAction traceId={event.traceId} /> : null,
 *   }),
 * ]
 */
export const LogEventDetailSlot = createSlot<{
  /** The expanded log event (already loaded by the host row). */
  event: LogEvent;
}>("plugin.logstream.event-detail");
