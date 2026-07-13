/**
 * Per-pod, approximate ingest counters surfaced on the stream overview page
 * (plan §5 performance guardrails). These are in-memory and pod-local: they
 * describe THIS process's intake, not the cluster's - the durable rates come
 * from the severity buckets. The API area reads them through
 * {@link getIngestCounters}.
 *
 * Pure module: no IO.
 */

import type { IngestCounters } from "@checkstack/logstream-common";

interface MutableCounters {
  linesReceived: number;
  linesDropped: number;
  flushes: number;
  lastFlushMs: number;
}

/** A registry of per-stream counters. One process-wide instance is the default
 * (see {@link ingestCounters}); tests can instantiate their own. */
export class IngestCountersRegistry {
  private readonly byStream = new Map<string, MutableCounters>();

  private forStream(streamId: string): MutableCounters {
    let counters = this.byStream.get(streamId);
    if (!counters) {
      counters = { linesReceived: 0, linesDropped: 0, flushes: 0, lastFlushMs: 0 };
      this.byStream.set(streamId, counters);
    }
    return counters;
  }

  addReceived(streamId: string, n: number): void {
    this.forStream(streamId).linesReceived += n;
  }

  addDropped(streamId: string, n: number): void {
    this.forStream(streamId).linesDropped += n;
  }

  recordFlush(streamId: string, elapsedMs: number): void {
    const counters = this.forStream(streamId);
    counters.flushes += 1;
    counters.lastFlushMs = Math.round(elapsedMs);
  }

  /** Snapshot a stream's counters (all zeroes if the stream is unseen). */
  get(streamId: string): IngestCounters {
    const counters = this.byStream.get(streamId);
    return {
      linesReceived: counters?.linesReceived ?? 0,
      linesDropped: counters?.linesDropped ?? 0,
      flushes: counters?.flushes ?? 0,
      lastFlushMs: counters?.lastFlushMs ?? 0,
    };
  }
}

/** The process-wide counters the running ingest pipeline updates. */
export const ingestCounters = new IngestCountersRegistry();

/**
 * Read a stream's per-pod ingest counters. Stable import surface for the API
 * area: `import { getIngestCounters } from "../ingest"`.
 */
export function getIngestCounters(streamId: string): IngestCounters {
  return ingestCounters.get(streamId);
}
