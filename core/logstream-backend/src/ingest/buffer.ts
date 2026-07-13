/**
 * Bounded, per-pod WRITE buffer for normalized ingest lines. The buffering
 * mechanism (line/byte caps, per-stream fair share, 429 semantics) lives in the
 * generic `@checkstack/ingest-utils` {@link IngestBuffer}; this module binds it
 * to logstream's {@link IngestedLine} item type and its `estimateLineBytes` heap
 * estimate, preserving logstream's `push({ streamId, lines })` /
 * `streamSize(streamId)` surface.
 *
 * STATE & SCALE: a short-lived pod-local write buffer, NEVER a queryable source
 * of truth - each pod buffers and flushes its own intake independently. See the
 * shared module and state-and-scale.md.
 */

import {
  IngestBuffer as GenericIngestBuffer,
  DEFAULT_BUFFER_GLOBAL_CAP,
  DEFAULT_BUFFER_BYTE_CAP,
  type BufferPushResult,
} from "@checkstack/ingest-utils";
import type { IngestedLine } from "@checkstack/logstream-common";

export {
  DEFAULT_BUFFER_GLOBAL_CAP,
  DEFAULT_BUFFER_BYTE_CAP,
} from "@checkstack/ingest-utils";
export type { BufferPushResult } from "@checkstack/ingest-utils";

/** Fixed per-line heap overhead estimate (object headers, fixed columns). */
const LINE_FIXED_OVERHEAD_BYTES = 64;

export class IngestBuffer {
  private readonly inner: GenericIngestBuffer<IngestedLine>;

  constructor(
    globalCap: number = DEFAULT_BUFFER_GLOBAL_CAP,
    byteCap: number = DEFAULT_BUFFER_BYTE_CAP,
  ) {
    this.inner = new GenericIngestBuffer<IngestedLine>({
      estimateBytes: estimateLineBytes,
      globalCap,
      byteCap,
    });
  }

  /** Current buffered line count across all streams. */
  get size(): number {
    return this.inner.size;
  }

  /** Current approximate buffered byte count across all streams. */
  get byteSize(): number {
    return this.inner.byteSize;
  }

  /** Buffered line count for one stream. */
  streamSize(streamId: string): number {
    return this.inner.keySize(streamId);
  }

  /**
   * Push lines for a stream. Returns how many were accepted vs rejected
   * (rejected => the caller answers 429).
   */
  push({
    streamId,
    lines,
  }: {
    streamId: string;
    lines: IngestedLine[];
  }): BufferPushResult {
    return this.inner.push({ key: streamId, items: lines });
  }

  /** Remove and return all buffered lines grouped by stream, resetting size + bytes. */
  drain(): Map<string, IngestedLine[]> {
    return this.inner.drain();
  }
}

/**
 * Approximate the heap bytes a normalized line occupies. Cheap and shallow
 * (no full `JSON.stringify` of the whole line): body length dominates, plus a
 * shallow walk of the pre-capped attributes/resource objects and the small
 * fixed fields. Accuracy need only be good enough to guard against OOM.
 */
export function estimateLineBytes(line: IngestedLine): number {
  let bytes = line.body.length + LINE_FIXED_OVERHEAD_BYTES;
  if (line.severityText) bytes += line.severityText.length;
  if (line.traceId) bytes += line.traceId.length;
  if (line.spanId) bytes += line.spanId.length;
  if (line.attributes) bytes += estimateObjectBytes(line.attributes);
  if (line.resource) bytes += estimateObjectBytes(line.resource);
  return bytes;
}

function estimateObjectBytes(obj: Record<string, unknown>): number {
  let bytes = 0;
  for (const [key, value] of Object.entries(obj)) {
    bytes += key.length + estimateValueBytes(value);
  }
  return bytes;
}

function estimateValueBytes(value: unknown): number {
  if (typeof value === "string") return value.length;
  if (typeof value === "number" || typeof value === "boolean") return 8;
  if (value === null || value === undefined) return 4;
  // Nested object/array: fall back to a JSON size. Attributes are pre-capped at
  // ~8KB during normalization, so this stays bounded.
  try {
    return JSON.stringify(value).length;
  } catch {
    return 16;
  }
}
