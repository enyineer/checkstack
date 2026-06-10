import { z } from "zod";
import { HealthCheckStatusSchema } from "@checkstack/healthcheck-common";

/**
 * Model-facing lean shapes for the AI tool projections (see
 * `aiToolProjectionExtensionPoint.expose({ projectResult })`). The chat/MCP
 * read-loop still re-enters the real procedure as the principal and gets the
 * FULL output (authz + audit unchanged); these mappers only trim the shape that
 * enters the model's context window.
 *
 * `getHistory` returns ~9 fields per run. For the timeline/root-cause questions
 * the assistant uses it for, the model only needs WHEN, WHAT status, how SLOW,
 * and from WHERE — the opaque ids (`id`, `configurationId`, `systemId`,
 * `environmentId`, `sourceId`) are echoed back to it from its own arguments and
 * waste context, especially since history is replayed verbatim every turn.
 */

/** A run as the public `getHistory` returns it (only the fields we read). */
const RunShape = z.object({
  status: HealthCheckStatusSchema,
  timestamp: z.union([z.date(), z.string()]),
  latencyMs: z.number().optional(),
  sourceLabel: z.string().optional(),
});

const HistoryShape = z.object({
  runs: z.array(RunShape),
  total: z.number(),
});

/** Compact run: time + status + latency + source label. */
export interface LeanRun {
  timestamp: string;
  status: z.infer<typeof HealthCheckStatusSchema>;
  latencyMs?: number;
  sourceLabel?: string;
}

/**
 * Project a `getHistory` result into the lean per-run shape. Defensive: if the
 * output does not match the expected shape (a future schema change), it is
 * returned unchanged — the generic clamp is the backstop, so a mismatch never
 * crashes the read, it just sends the full shape.
 */
export function projectRunHistoryForModel(output: unknown): unknown {
  const parsed = HistoryShape.safeParse(output);
  if (!parsed.success) return output;
  const { runs, total } = parsed.data;
  const lean: LeanRun[] = runs.map((r) => ({
    timestamp:
      r.timestamp instanceof Date ? r.timestamp.toISOString() : r.timestamp,
    status: r.status,
    ...(r.latencyMs === undefined ? {} : { latencyMs: r.latencyMs }),
    ...(r.sourceLabel === undefined ? {} : { sourceLabel: r.sourceLabel }),
  }));
  // `returned` makes the page size explicit next to `total`, so the model knows
  // how much of the window it actually saw without counting the array.
  return { runs: lean, returned: lean.length, total };
}
