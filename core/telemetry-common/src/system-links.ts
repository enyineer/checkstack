/**
 * Shared schemas for EXPLICIT stream -> catalog-system links. Every stream
 * plugin (logstream / metricstream / tracestream) declares the same four
 * procedures over its own junction table; the input/output shapes live here
 * so the three contracts cannot drift. The links are explicit by decision:
 * the UI SUGGESTS candidates from observed `service.name` values, and a
 * human applies them - never auto-linked.
 *
 * Authorization shape (see `.claude/rules/rlac.md`):
 * - `listSystemLinks` / `setSystemLinks`: scoped by the STREAM
 *   (`instanceAccess: { idParam: "streamId" }`, read/manage respectively).
 *   The write handler must additionally verify the caller can READ every
 *   NEWLY ADDED system (the diff against the currently persisted set) - a
 *   stream manager cannot expose a system they cannot see. Retained and
 *   removed ids need NO readability: a manager who cannot read a system
 *   another user linked must still be able to save unrelated changes (or
 *   unlink it) without being dead-locked by that link. The check runs as a
 *   USER-scoped caller (one `getSystems` membership pass, not per-id
 *   probes) BEFORE anything persists.
 * - `listStreamsForSystem` / `listLinkedStreamStatuses`: the system page /
 *   dashboard direction; post-filtered to the caller's readable streams
 *   (`listKey`), so a caller only learns about streams they can read.
 */

import { z } from "zod";

/** Max systems one stream may link (defensive cap; UI is a picker). */
export const MAX_SYSTEM_LINKS_PER_STREAM = 200;
/** Max systems one bulk status lookup may cover (the dashboard passes all
 * visible systems in one call). */
export const MAX_SYSTEMS_PER_STATUS_LOOKUP = 500;

export const ListSystemLinksSchema = z.object({
  streamId: z.string(),
});
export type ListSystemLinks = z.infer<typeof ListSystemLinksSchema>;

export const ListSystemLinksResultSchema = z.object({
  systemIds: z.array(z.string()),
});
export type ListSystemLinksResult = z.infer<
  typeof ListSystemLinksResultSchema
>;

export const SetSystemLinksSchema = z.object({
  streamId: z.string(),
  /** Full replacement set (the editor is a picker, not a patch API). */
  systemIds: z.array(z.string()).max(MAX_SYSTEM_LINKS_PER_STREAM),
});
export type SetSystemLinks = z.infer<typeof SetSystemLinksSchema>;

export const ListStreamsForSystemSchema = z.object({
  systemId: z.string(),
});
export type ListStreamsForSystem = z.infer<typeof ListStreamsForSystemSchema>;

/** One linked stream on the system page. `id` is the STREAM id - the field
 * the listKey RLAC filter keys on. */
export const LinkedStreamSchema = z.object({
  id: z.string(),
  name: z.string(),
});
export type LinkedStream = z.infer<typeof LinkedStreamSchema>;

export const ListStreamsForSystemResultSchema = z.object({
  streams: z.array(LinkedStreamSchema),
});
export type ListStreamsForSystemResult = z.infer<
  typeof ListStreamsForSystemResultSchema
>;

export const ListLinkedStreamStatusesSchema = z.object({
  systemIds: z.array(z.string()).max(MAX_SYSTEMS_PER_STATUS_LOOKUP),
});
export type ListLinkedStreamStatuses = z.infer<
  typeof ListLinkedStreamStatusesSchema
>;

/**
 * A linked stream's signal-worthy state for the dashboard's system signals:
 * the newest recent (last 24h) SIGNAL-WORTHY important event, if any. Each
 * plugin's handler filters the event lookup to the exact types its
 * dashboard deriver surfaces (e.g. logstream: spike) - the newest event of
 * ANY type would let a benign event (new_pattern, silence_recovered) mask
 * an active spike recorded minutes earlier. `id` is the STREAM id
 * (listKey); `systemIds` restates which of the requested systems the stream
 * is linked to so the filler can regroup per system.
 */
export const LinkedStreamStatusSchema = z.object({
  id: z.string(),
  name: z.string(),
  systemIds: z.array(z.string()),
  lastImportantEvent: z
    .object({
      type: z.string(),
      ts: z.date(),
    })
    .nullable(),
});
export type LinkedStreamStatus = z.infer<typeof LinkedStreamStatusSchema>;

export const ListLinkedStreamStatusesResultSchema = z.object({
  matches: z.array(LinkedStreamStatusSchema),
});
export type ListLinkedStreamStatusesResult = z.infer<
  typeof ListLinkedStreamStatusesResultSchema
>;

/**
 * Chunk a dashboard's system-id list to the status lookup's input cap. The
 * dashboard passes EVERY visible system in one slot context; a deployment
 * with more systems than {@link MAX_SYSTEMS_PER_STATUS_LOOKUP} must not make
 * the fillers' queries fail input validation (signals would silently vanish).
 * Fillers fetch each chunk and concatenate the matches - a stream linked to
 * systems in two chunks appears in both results, so callers must merge by
 * stream id (union the `systemIds`) rather than blindly concatenating.
 */
export function chunkSystemIdsForStatusLookup(
  systemIds: readonly string[],
): string[][] {
  const chunks: string[][] = [];
  for (
    let index = 0;
    index < systemIds.length;
    index += MAX_SYSTEMS_PER_STATUS_LOOKUP
  ) {
    chunks.push(
      systemIds.slice(index, index + MAX_SYSTEMS_PER_STATUS_LOOKUP),
    );
  }
  return chunks;
}

/** Merge chunked status results: one entry per stream, `systemIds` unioned. */
export function mergeLinkedStreamStatuses(
  chunkResults: readonly ListLinkedStreamStatusesResult[],
): LinkedStreamStatus[] {
  const byStream = new Map<string, LinkedStreamStatus>();
  for (const result of chunkResults) {
    for (const match of result.matches) {
      const existing = byStream.get(match.id);
      if (!existing) {
        byStream.set(match.id, {
          ...match,
          systemIds: [...match.systemIds],
        });
        continue;
      }
      for (const systemId of match.systemIds) {
        if (!existing.systemIds.includes(systemId)) {
          existing.systemIds.push(systemId);
        }
      }
      // Chunks query the same 24h window; keep the newest event either way.
      if (
        match.lastImportantEvent &&
        (!existing.lastImportantEvent ||
          match.lastImportantEvent.ts > existing.lastImportantEvent.ts)
      ) {
        existing.lastImportantEvent = match.lastImportantEvent;
      }
    }
  }
  return [...byStream.values()];
}
