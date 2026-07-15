import type { TraceSamplingConfig } from "@checkstack/tracestream-common";

/**
 * Turn a tail-sampling policy into plain-language sentences for the Settings
 * form, so an operator understands what will actually be retained without
 * decoding the raw knobs. Pure and unit-tested: the copy is the contract
 * between the numbers and the operator's mental model, and a wrong sentence
 * ("kept" vs "dropped") is a real bug.
 *
 * The rules compose in the order the sink applies them: error traces first,
 * then slow traces, then a baseline sample of everything else.
 */
export function describeSamplingPolicy(config: TraceSamplingConfig): string[] {
  const lines: string[] = [
    config.keepErrorTraces
      ? "Every trace with at least one error span is kept."
      : "Error traces are not specially retained.",
  ];

  if (config.slowTraceThresholdMs !== null) {
    lines.push(
      `Traces slower than ${formatThreshold(config.slowTraceThresholdMs)} are kept.`,
    );
  }

  const percent = formatBaselinePercent(config.baselineSampleRate);
  lines.push(
    config.baselineSampleRate <= 0
      ? "None of the remaining traces are kept as a baseline."
      : `${percent} of the remaining traces are kept as a baseline sample.`,
  );

  if (config.maxRetainedTracesPerHour !== null) {
    lines.push(
      `At most ${formatCount(config.maxRetainedTracesPerHour)} traces are retained per hour; the rest keep a summary only.`,
    );
  }

  return lines;
}

/** Format a slow-trace threshold in ms as a readable "1,000 ms" / "2.5 s". */
export function formatThreshold(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const seconds = ms / 1000;
  const rendered = Number.isInteger(seconds) ? `${seconds}` : seconds.toFixed(1);
  return `${rendered} s`;
}

/**
 * Format a 0..1 baseline rate as a percentage, keeping small rates legible
 * (0.01 -> "1%", 0.001 -> "0.1%") without trailing-zero noise.
 */
export function formatBaselinePercent(rate: number): string {
  const clamped = Math.min(1, Math.max(0, rate));
  const percent = clamped * 100;
  const rendered =
    percent >= 1 || percent === 0
      ? `${Math.round(percent)}`
      : percent.toFixed(percent < 0.1 ? 2 : 1);
  return `${rendered}%`;
}

function formatCount(n: number): string {
  return n.toLocaleString("en-US");
}
