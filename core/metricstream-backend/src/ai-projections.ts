import { z } from "zod";

/**
 * Model-facing lean shape for the `metricstream.listStreams` AI projection (see
 * `aiToolProjectionExtensionPoint.expose({ projectResult })`). The chat/MCP
 * read-loop re-enters the real `listStreams` procedure as the principal and gets
 * the FULL output (authz + audit unchanged); this mapper only trims the shape
 * that enters the model's context window.
 *
 * `listStreams` returns each stream's full `config` (the cardinality / rate /
 * retention policy) plus `createdAt` / `updatedAt`. For the "what metric streams
 * exist / which stream is X" questions the assistant uses this for, only the
 * `id` (to feed `listMetricNames` / `getMetricBuckets`), `name` and
 * `description` matter - the policy block and timestamps are noise that would
 * blow the context on a plugin with many streams.
 */
const StreamShape = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
});
const ListStreamsShape = z.object({ streams: z.array(StreamShape) });

/** Compact stream: id + name + description only. */
export interface LeanStream {
  id: string;
  name: string;
  description: string | null;
}

/**
 * Project a `listStreams` result into the lean per-stream shape. Defensive: if
 * the output does not match the expected shape (a future schema change), it is
 * returned unchanged - the generic clamp is the backstop, so a mismatch never
 * crashes the read, it just sends the full shape.
 */
export function projectStreamListForModel(output: unknown): unknown {
  const parsed = ListStreamsShape.safeParse(output);
  if (!parsed.success) return output;
  const streams: LeanStream[] = parsed.data.streams.map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
  }));
  return { streams, returned: streams.length };
}
