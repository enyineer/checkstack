/**
 * Bounded-buffering capture of a child's stdout + stderr.
 *
 * The naive `new Response(stream).text()` buffers the ENTIRE stream before any
 * truncation runs, so on a degraded host without the `RLIMIT_AS` cap a script
 * emitting gigabytes OOMs the pod before {@link truncateCapturedOutput} ever
 * sees the data (plan §5.1). This reader instead counts bytes as they arrive
 * off BOTH streams against a single shared budget, stops buffering once the
 * budget is exhausted, invokes `onExceeded` (so the caller can kill the child),
 * and flags `truncated`. Buffering is therefore bounded to roughly
 * `maxOutputBytes` plus one in-flight chunk per stream.
 *
 * It is pure JS reading `ReadableStream<Uint8Array>` handles, so it works
 * identically on every platform — the portable resource-cap fallback.
 */

export interface CappedOutputResult {
  stdout: string;
  stderr: string;
  /** True when the combined output reached the cap and capture was stopped. */
  truncated: boolean;
}

/**
 * A growable byte buffer that stops appending once a shared budget is hit.
 * The two streams share one {@link SharedByteBudget} so the COMBINED output is
 * bounded, matching {@link truncateCapturedOutput}'s combined-budget contract.
 */
class SharedByteBudget {
  private remaining: number;
  private exceeded = false;

  constructor(private readonly limit: number) {
    this.remaining = limit;
  }

  /**
   * Reserve up to `wanted` bytes from the shared budget. Returns how many bytes
   * may still be appended (0 once the budget is exhausted). Sets the exceeded
   * flag the first time a chunk does not fully fit.
   */
  take(wanted: number): number {
    if (this.remaining <= 0) {
      if (wanted > 0) this.exceeded = true;
      return 0;
    }
    if (wanted > this.remaining) {
      this.exceeded = true;
      const grant = this.remaining;
      this.remaining = 0;
      return grant;
    }
    this.remaining -= wanted;
    return wanted;
  }

  get isExceeded(): boolean {
    return this.exceeded;
  }

  get isUncapped(): boolean {
    return this.limit === Number.POSITIVE_INFINITY;
  }
}

/**
 * Drain one stream into `chunks`, taking bytes from the shared budget. Decoding
 * is deferred to the end (a UTF-8 decoder is stateful across chunk boundaries),
 * so we keep the raw bytes we were allowed to keep and decode once.
 *
 * Once the budget is exhausted we call `onCap` (idempotent at the call site)
 * and CANCEL the stream — cancelling releases the producer so the child does
 * not block on a full pipe, and combined with the caller killing the child this
 * stops further output promptly without unbounded buffering.
 */
async function drainStream({
  stream,
  budget,
  onCap,
}: {
  stream: ReadableStream<Uint8Array>;
  budget: SharedByteBudget;
  onCap: () => void;
}): Promise<Uint8Array> {
  const reader = stream.getReader();
  const kept: Uint8Array[] = [];
  let keptLength = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value === undefined || value.length === 0) continue;
      if (budget.isUncapped) {
        kept.push(value);
        keptLength += value.length;
        continue;
      }
      const grant = budget.take(value.length);
      if (grant > 0) {
        const slice = grant === value.length ? value : value.subarray(0, grant);
        kept.push(slice);
        keptLength += slice.length;
      }
      if (budget.isExceeded) {
        onCap();
        // Stop buffering; cancel releases the producer so it cannot keep the
        // pipe full and wedge the child.
        await reader.cancel().catch(() => {
          // Best-effort: the stream may already be closed by the kill.
        });
        break;
      }
    }
  } catch {
    // A cancel mid-read (from the kill path) surfaces as a read rejection;
    // treat it as end-of-stream and keep whatever we already captured.
  } finally {
    reader.releaseLock();
  }

  if (kept.length === 1) return kept[0]!;
  const merged = new Uint8Array(keptLength);
  let offset = 0;
  for (const chunk of kept) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

/**
 * Capture a child's stdout + stderr with bounded buffering. When
 * `maxOutputBytes` is undefined the streams are drained in full (the
 * back-compat / opted-out path). Otherwise the COMBINED captured bytes are
 * capped; on overflow `onExceeded` is invoked exactly once and `truncated` is
 * set so the runner can flag the run and downgrade the result.
 */
export async function readCappedOutput({
  stdout,
  stderr,
  maxOutputBytes,
  onExceeded,
}: {
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  maxOutputBytes: number | undefined;
  /** Called once (at most) when the combined output first exceeds the cap. */
  onExceeded?: () => void;
}): Promise<CappedOutputResult> {
  const limit =
    maxOutputBytes === undefined ? Number.POSITIVE_INFINITY : maxOutputBytes;
  const budget = new SharedByteBudget(limit);

  let capFired = false;
  const onCap = () => {
    if (capFired) return;
    capFired = true;
    onExceeded?.();
  };

  const [stdoutBytes, stderrBytes] = await Promise.all([
    drainStream({ stream: stdout, budget, onCap }),
    drainStream({ stream: stderr, budget, onCap }),
  ]);

  const decoder = new TextDecoder();
  return {
    stdout: decoder.decode(stdoutBytes),
    stderr: new TextDecoder().decode(stderrBytes),
    truncated: budget.isExceeded,
  };
}
