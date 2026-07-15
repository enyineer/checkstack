/**
 * The per-instance sink a source implementation writes to. A source emits
 * normalized records for a signal; the bound sink routes them to the stream the
 * instance bound for that signal, via the signal owner's registered sink. A
 * signal the instance did not bind is a legal no-op (`bound: false`) - a
 * multi-signal type may emit more than a given instance routes.
 *
 * Two flavors:
 * - {@link createBoundSink}: the real routing sink used by pull runs and webhook
 *   deliveries. It calls the owning sink's `write`.
 * - {@link createCountingSink}: a dry-run sink for the editor "Test connection"
 *   that COUNTS emitted records per signal but writes NOTHING.
 *
 * Both accumulate per-signal accepted totals so a run/test can report record
 * counts.
 */

import type { TelemetrySignal } from "@checkstack/telemetry-common";
import type {
  BoundTelemetrySink,
  TelemetrySinkRegistry,
  TelemetrySourceRef,
} from "./extension-points";

/** A bound sink plus its accumulated per-signal accepted counts. */
export interface CountingBoundSink {
  sink: BoundTelemetrySink;
  /** Accepted record totals per signal since creation. */
  getCounts(): Partial<Record<TelemetrySignal, number>>;
}

interface SignalBinding {
  signal: TelemetrySignal;
  streamId: string;
}

/**
 * Build the routing sink for one source instance. `emit(signal, records)`
 * routes to the stream bound for `signal` through that signal's registered
 * sink; an unbound signal returns `{ accepted: 0, rejected: 0, bound: false }`.
 * A bound signal whose owning sink is not currently registered (owning plugin
 * uninstalled) counts every record as rejected.
 */
export function createBoundSink({
  bindings,
  sinkRegistry,
  sourceRef,
  now = () => new Date(),
}: {
  bindings: SignalBinding[];
  sinkRegistry: TelemetrySinkRegistry;
  sourceRef: TelemetrySourceRef;
  now?: () => Date;
}): CountingBoundSink {
  const boundBySignal = new Map<TelemetrySignal, string>(
    bindings.map((b) => [b.signal, b.streamId]),
  );
  const counts = new Map<TelemetrySignal, number>();

  const sink: BoundTelemetrySink = {
    boundSignals: [...boundBySignal.keys()],
    async emit(signal, records) {
      const streamId = boundBySignal.get(signal);
      if (streamId === undefined) {
        return { accepted: 0, rejected: 0, bound: false };
      }
      const owningSink = sinkRegistry.get(signal);
      if (!owningSink) {
        return { accepted: 0, rejected: records.length, bound: true };
      }
      const result = await owningSink.write({
        streamId,
        records,
        source: sourceRef,
        now: now(),
      });
      addCount(counts, signal, result.accepted);
      return { ...result, bound: true };
    },
  };

  return { sink, getCounts: () => countsToObject(counts) };
}

/**
 * Build a dry-run sink for the config test: it accepts every signal the type
 * can emit (so nothing is dropped as "unbound") and counts records WITHOUT
 * writing to any real stream.
 */
export function createCountingSink({
  signals,
}: {
  signals: TelemetrySignal[];
}): CountingBoundSink {
  const boundSignals = [...new Set(signals)];
  const accepted = new Set(boundSignals);
  const counts = new Map<TelemetrySignal, number>();

  const sink: BoundTelemetrySink = {
    boundSignals,
    async emit(signal, records) {
      if (!accepted.has(signal)) {
        return { accepted: 0, rejected: 0, bound: false };
      }
      addCount(counts, signal, records.length);
      return { accepted: records.length, rejected: 0, bound: true };
    },
  };

  return { sink, getCounts: () => countsToObject(counts) };
}

function addCount(
  counts: Map<TelemetrySignal, number>,
  signal: TelemetrySignal,
  delta: number,
): void {
  counts.set(signal, (counts.get(signal) ?? 0) + delta);
}

function countsToObject(
  counts: Map<TelemetrySignal, number>,
): Partial<Record<TelemetrySignal, number>> {
  const out: Partial<Record<TelemetrySignal, number>> = {};
  for (const [signal, count] of counts) out[signal] = count;
  return out;
}
