import { z } from "zod";
import { SeverityBandSchema } from "@checkstack/logstream-common";

/**
 * Model-facing lean shape for the `logstream.searchLogs` projection (see
 * `aiToolProjectionExtensionPoint.expose({ projectResult })`). The chat/MCP
 * read-loop still re-enters the real `searchEvents` procedure as the principal
 * and gets the FULL output (authz + audit unchanged); this mapper only trims the
 * shape that enters the model's context window.
 *
 * A raw `log_events` row carries unbounded `attributes`/`resource` jsonb, a full
 * (up to 32 KB) body, and several opaque ids the model only echoes back. For the
 * "what errors happened / find lines matching X" questions searchLogs answers,
 * the model needs WHEN, HOW SEVERE, the (clamped) MESSAGE, and the correlation
 * handles (patternId / traceId) - nothing else.
 */

/** Max body characters kept per line in the lean projection. */
const MAX_BODY_CHARS = 300;

/** A stored event as `searchEvents` returns it (only the fields we read). */
const EventShape = z.object({
  ts: z.union([z.date(), z.string()]),
  band: SeverityBandSchema,
  severityText: z.string().nullable().optional(),
  body: z.string(),
  patternId: z.string().nullable().optional(),
  traceId: z.string().nullable().optional(),
});

const SearchResultShape = z.object({
  events: z.array(EventShape),
});

/** Compact log line: time + band + (clamped) body + correlation handles. */
export interface LeanLogEvent {
  ts: string;
  band: z.infer<typeof SeverityBandSchema>;
  severityText?: string;
  body: string;
  /** Set only when the clamp actually truncated the body. */
  truncated?: boolean;
  patternId?: string;
  traceId?: string;
}

/**
 * Project a `searchEvents` result into the lean per-line shape. Defensive: if
 * the output does not match the expected shape (a future schema change), it is
 * returned unchanged - the generic clamp is the backstop, so a mismatch never
 * crashes the read, it just sends the full shape.
 */
export function projectLogEventsForModel(output: unknown): unknown {
  const parsed = SearchResultShape.safeParse(output);
  if (!parsed.success) return output;
  const events: LeanLogEvent[] = parsed.data.events.map((e) => {
    const clampedBody = e.body.slice(0, MAX_BODY_CHARS);
    return {
      ts: e.ts instanceof Date ? e.ts.toISOString() : e.ts,
      band: e.band,
      ...(e.severityText ? { severityText: e.severityText } : {}),
      body: clampedBody,
      ...(clampedBody.length < e.body.length ? { truncated: true } : {}),
      ...(e.patternId ? { patternId: e.patternId } : {}),
      ...(e.traceId ? { traceId: e.traceId } : {}),
    };
  });
  // `returned` makes the page size explicit so the model knows how much of the
  // window it actually saw without counting the array (the cursor is dropped -
  // it is an opaque handle the model cannot usefully act on).
  return { events, returned: events.length };
}
