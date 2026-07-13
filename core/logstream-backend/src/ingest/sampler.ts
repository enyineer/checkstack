/**
 * Tiered raw-line selection (plan §5, step 3). Aggregates always carry full
 * volume; raw `log_events` rows are a capped, investigable subset:
 *
 * - WARN and above: always kept (the assertable signal).
 * - INFO/DEBUG/TRACE: keep the first {@link FIRST_N_PER_PATTERN_MINUTE} per
 *   `(pattern, minute)` for shape coverage, plus a random `infoSampleRate`
 *   sample of the rest.
 * - A hard `maxRawPerMinute` per stream caps kept rows; overflow of the SAMPLED
 *   tier is dropped and counted (WARN+ is never dropped).
 *
 * The per-`(pattern, minute)` and per-`(stream, minute)` counters span flushes
 * (a minute is ~120 flushes), so the sampler is stateful and pod-local; old
 * minutes are pruned to bound memory. `rng` is injectable for deterministic
 * tests.
 */

import {
  SEVERITY_BAND_RANK,
  type IngestedLine,
  type LogStreamConfig,
  type SeverityBand,
} from "@checkstack/logstream-common";

export const FIRST_N_PER_PATTERN_MINUTE = 3;
const WARN_RANK = SEVERITY_BAND_RANK.warn;
/** Minutes of counter history to retain before pruning. */
const MINUTE_RETENTION = 2;

/** A line entering the sampler, already classified + bucketed. */
export interface SamplerInput {
  line: IngestedLine;
  patternId: string;
  band: SeverityBand;
  /** Epoch-minute of the line's event time (`floor(ts/60000)`). */
  minuteEpoch: number;
}

export interface SamplerOutput {
  kept: SamplerInput[];
  /** Sampled lines dropped because the per-minute cap was hit. */
  droppedByCap: number;
}

export class RawSampler {
  private readonly patternMinuteKept = new Map<string, number>();
  private readonly streamMinuteKept = new Map<string, number>();
  private newestMinute = 0;

  constructor(private readonly rng: () => number = Math.random) {}

  /**
   * Select which of a stream's classified lines to persist as raw rows.
   * Counters advance as lines are kept, so calling once per flush honors the
   * per-minute budgets across the whole minute.
   *
   * `now` is the flush's SERVER time and is the ONLY thing that advances the
   * prune anchor. Deriving it from the lines' event minute would let a single
   * future-dated line jump `newestMinute` forward and prune every live
   * per-minute counter across all streams; anchoring to server time bounds the
   * retained window to real time regardless of client timestamps (event `ts`
   * is also clamped upstream, so `minuteEpoch` keys stay near real time too).
   */
  select({
    streamId,
    lines,
    config,
    now,
  }: {
    streamId: string;
    lines: SamplerInput[];
    config: LogStreamConfig;
    now: Date;
  }): SamplerOutput {
    const kept: SamplerInput[] = [];
    let droppedByCap = 0;

    const nowEpoch = Math.floor(now.getTime() / 60_000);
    if (nowEpoch > this.newestMinute) {
      this.newestMinute = nowEpoch;
      this.prune();
    }

    for (const item of lines) {
      const rank = SEVERITY_BAND_RANK[item.band];
      const streamKey = `${streamId}|${item.minuteEpoch}`;

      if (rank >= WARN_RANK) {
        kept.push(item);
        this.bump(this.streamMinuteKept, streamKey);
        continue;
      }

      const patternKey = `${streamId}|${item.patternId}|${item.minuteEpoch}`;
      const seen = this.patternMinuteKept.get(patternKey) ?? 0;
      const wantKeep =
        seen < FIRST_N_PER_PATTERN_MINUTE || this.rng() < config.infoSampleRate;
      if (!wantKeep) continue;

      const streamKept = this.streamMinuteKept.get(streamKey) ?? 0;
      if (streamKept >= config.maxRawPerMinute) {
        droppedByCap += 1;
        continue;
      }

      kept.push(item);
      this.bump(this.patternMinuteKept, patternKey);
      this.bump(this.streamMinuteKept, streamKey);
    }

    return { kept, droppedByCap };
  }

  private bump(map: Map<string, number>, key: string): void {
    map.set(key, (map.get(key) ?? 0) + 1);
  }

  private prune(): void {
    const cutoff = this.newestMinute - MINUTE_RETENTION;
    pruneOlderThan(this.patternMinuteKept, cutoff);
    pruneOlderThan(this.streamMinuteKept, cutoff);
  }
}

/** Keys end with `|<minuteEpoch>`; drop those strictly older than `cutoff`. */
function pruneOlderThan(map: Map<string, number>, cutoff: number): void {
  for (const key of map.keys()) {
    const minute = Number.parseInt(key.slice(key.lastIndexOf("|") + 1), 10);
    if (minute < cutoff) map.delete(key);
  }
}
