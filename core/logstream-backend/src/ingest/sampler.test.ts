import { describe, it, expect } from "bun:test";
import {
  DEFAULT_LOG_STREAM_CONFIG,
  type IngestedLine,
  type LogStreamConfig,
  type SeverityBand,
} from "@checkstack/logstream-common";
import { RawSampler, FIRST_N_PER_PATTERN_MINUTE, type SamplerInput } from "./sampler";

function input(band: SeverityBand, patternId: string, minute = 100): SamplerInput {
  const line: IngestedLine = {
    ts: new Date(minute * 60_000),
    observedAt: new Date(minute * 60_000),
    severityNumber: 9,
    band,
    body: "x",
  };
  return { line, patternId, band, minuteEpoch: minute };
}

/** Server "now" aligned to the inputs' minute so pruning keeps their counters. */
const now = new Date(100 * 60_000);

describe("RawSampler", () => {
  it("always keeps WARN and above", () => {
    const sampler = new RawSampler(() => 1); // rng always rejects samples
    const lines = [
      input("warn", "p1"),
      input("error", "p1"),
      input("fatal", "p1"),
    ];
    const { kept, droppedByCap } = sampler.select({
      streamId: "s",
      lines,
      config: DEFAULT_LOG_STREAM_CONFIG,
      now,
    });
    expect(kept).toHaveLength(3);
    expect(droppedByCap).toBe(0);
  });

  it("keeps the first N info lines per (pattern, minute) then samples", () => {
    const sampler = new RawSampler(() => 1); // never random-sample
    const lines = Array.from({ length: 10 }, () => input("info", "p1"));
    const { kept } = sampler.select({
      streamId: "s",
      lines,
      config: DEFAULT_LOG_STREAM_CONFIG,
      now,
    });
    expect(kept).toHaveLength(FIRST_N_PER_PATTERN_MINUTE);
  });

  it("random-samples the rest at infoSampleRate", () => {
    const sampler = new RawSampler(() => 0); // always pass the sample gate
    const config: LogStreamConfig = { ...DEFAULT_LOG_STREAM_CONFIG, infoSampleRate: 0.5 };
    const lines = Array.from({ length: 10 }, () => input("debug", "p1"));
    const { kept } = sampler.select({ streamId: "s", lines, config , now });
    // First 3 by position + all 7 remaining pass rng<0.5 -> all 10.
    expect(kept).toHaveLength(10);
  });

  it("enforces maxRawPerMinute on the sampled tier and counts drops", () => {
    const sampler = new RawSampler(() => 0);
    const config: LogStreamConfig = {
      ...DEFAULT_LOG_STREAM_CONFIG,
      maxRawPerMinute: 4,
      infoSampleRate: 1,
    };
    const lines = Array.from({ length: 10 }, (_, i) => input("info", `p${i}`));
    const { kept, droppedByCap } = sampler.select({ streamId: "s", lines, config , now });
    expect(kept).toHaveLength(4);
    expect(droppedByCap).toBe(6);
  });

  it("counters persist across select() calls within a minute", () => {
    const sampler = new RawSampler(() => 1);
    const config = DEFAULT_LOG_STREAM_CONFIG;
    const a = sampler.select({ streamId: "s", lines: [input("info", "p1"), input("info", "p1")], config , now });
    const b = sampler.select({ streamId: "s", lines: [input("info", "p1"), input("info", "p1")], config , now });
    // First call keeps 2 (positions 1,2), second keeps 1 (position 3), 4th dropped by sampling.
    expect(a.kept).toHaveLength(2);
    expect(b.kept).toHaveLength(1);
  });

  it("keeps only the first N per pattern when infoSampleRate is 0", () => {
    // rng always 0 would pass any positive gate, but rate 0 rejects every
    // sampled line, so only the first-N-per-(pattern,minute) survive.
    const sampler = new RawSampler(() => 0);
    const config: LogStreamConfig = { ...DEFAULT_LOG_STREAM_CONFIG, infoSampleRate: 0 };
    const lines = Array.from({ length: 10 }, () => input("info", "p1"));
    const { kept, droppedByCap } = sampler.select({ streamId: "s", lines, config, now });
    expect(kept).toHaveLength(FIRST_N_PER_PATTERN_MINUTE);
    expect(droppedByCap).toBe(0);
  });

  it("a single future-dated line does not prune the current minute's counters", () => {
    // Anchor pruning to server `now`, not the lines' event minute: a lone line
    // whose event minute is far ahead must not advance newestMinute and prune
    // the live per-(pattern,minute) counters for the real current minute.
    const sampler = new RawSampler(() => 1);
    const config = DEFAULT_LOG_STREAM_CONFIG;
    // Fill the first-N budget for p1 at the current minute.
    const first = sampler.select({
      streamId: "s",
      lines: [input("info", "p1"), input("info", "p1"), input("info", "p1")],
      config,
      now,
    });
    expect(first.kept).toHaveLength(FIRST_N_PER_PATTERN_MINUTE);
    // A future-dated line (event minute 100000) arrives; server `now` is still
    // the current minute, so the p1 counter must remain full.
    const withFuture = sampler.select({
      streamId: "s",
      lines: [input("info", "future", 100_000)],
      config,
      now,
    });
    // The future line is a new pattern, so its own first-N budget lets it in...
    expect(withFuture.kept).toHaveLength(1);
    // ...but p1's counter was NOT pruned: another p1 line is still over budget.
    const again = sampler.select({ streamId: "s", lines: [input("info", "p1")], config, now });
    expect(again.kept).toHaveLength(0);
  });
});
