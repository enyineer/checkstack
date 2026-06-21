import React, { useMemo } from "react";
import { cn } from "../../utils";
import { layoutWaterfall, type WaterfallPhase } from "./chart-math";

export interface RequestWaterfallProps {
  /**
   * Phases in execution order (e.g. DNS, TCP, TLS, Wait, Transfer). Durations
   * are in milliseconds. They are laid out end-to-end on ONE shared length
   * scale, so the longest bar IS the bottleneck.
   */
  phases: ReadonlyArray<WaterfallPhase>;
  /** Format a duration. Defaults to `${ms} ms`. */
  formatMs?: (ms: number) => string;
  /** Accessible label for the whole trace. Falls back to a generated summary. */
  ariaLabel?: string;
  className?: string;
}

/** Tone applied to a phase bar. The slowest phase always gets `warn`. */
function toneFor({ isSlowest }: { isSlowest: boolean }): string {
  return isSlowest ? "hsl(var(--status-warn))" : "hsl(var(--primary))";
}

/**
 * Single-run request timing waterfall. Each phase is a bar positioned at its
 * cumulative offset on a SHARED length scale, so the longest bar is literally
 * the bottleneck. The slowest phase is flagged (warn tone + a "slowest" badge)
 * and its share of the total is stated in text. Token-driven, light/dark.
 *
 * Accessibility: rendered as a labelled list; each row states phase, duration,
 * and (for the bottleneck) its percentage, so the bottleneck is conveyed by
 * text + glyph + position, never color alone.
 *
 * Drawn from `reviews/design/pro-console` "Timing waterfall".
 */
/**
 * Default duration formatter. Renders a measured-but-tiny phase (a fast local
 * connect, or a single-segment body transfer) as "<1 ms" rather than a bare
 * "0 ms", so a real sub-millisecond measurement does not read as "not
 * captured". A true zero (an absent / clamped phase) still shows "0 ms".
 */
function defaultFormatMs(ms: number): string {
  if (ms > 0 && ms < 1) return "<1 ms";
  return `${Math.round(ms)} ms`;
}

export const RequestWaterfall: React.FC<RequestWaterfallProps> = ({
  phases,
  formatMs = defaultFormatMs,
  ariaLabel,
  className,
}) => {
  const layout = useMemo(() => layoutWaterfall({ phases }), [phases]);

  const slowest = layout.phases.find((p) => p.isSlowest);
  const slowestShare =
    slowest && layout.totalMs > 0
      ? Math.round((slowest.durationMs / layout.totalMs) * 100)
      : 0;

  const description =
    ariaLabel ??
    `Request timing waterfall, total ${formatMs(layout.totalMs)}` +
      (slowest
        ? `. Slowest phase ${slowest.label} at ${formatMs(slowest.durationMs)}, ${slowestShare} percent of total.`
        : ".");

  return (
    <div
      role="group"
      aria-label={description}
      className={cn("flex flex-col gap-1.5", className)}
    >
      <ul className="flex flex-col gap-1.5 m-0 p-0 list-none">
        {layout.phases.map((p) => (
          <li
            key={p.id}
            className="grid items-center gap-3"
            style={{ gridTemplateColumns: "minmax(72px, max-content) 1fr 72px" }}
          >
            {/* Label column auto-sizes to its content so the "slowest" badge
                (stacked on its own line) never collides with the timing bar. */}
            <span className="flex flex-col gap-0.5 text-xs text-muted-foreground font-mono leading-tight">
              <span>{p.label}</span>
              {p.isSlowest && (
                <span className="w-fit rounded-sm bg-[hsl(var(--status-warn)/0.18)] px-1 text-[10px] font-semibold uppercase tracking-wide text-[hsl(var(--status-warn))]">
                  slowest
                </span>
              )}
            </span>
            <span className="relative block h-[18px] rounded-[var(--radius)] bg-[hsl(var(--surface-inset))]">
              <span
                className="absolute top-0 h-[18px] rounded-[var(--radius)]"
                style={{
                  left: `${p.leftFraction * 100}%`,
                  width: `${p.widthFraction * 100}%`,
                  minWidth: p.durationMs > 0 ? "2px" : 0,
                  background: toneFor({ isSlowest: p.isSlowest }),
                }}
              />
            </span>
            <span
              className={cn(
                "text-right font-mono text-xs tabular-nums",
                p.isSlowest
                  ? "text-[hsl(var(--status-warn))] font-semibold"
                  : "text-muted-foreground",
              )}
            >
              {formatMs(p.durationMs)}
            </span>
          </li>
        ))}
      </ul>
      {slowest && (
        <p className="m-0 text-xs text-muted-foreground">
          <span className="font-semibold text-[hsl(var(--status-warn))]">
            {slowest.label}
          </span>{" "}
          is {slowestShare}% of the {formatMs(layout.totalMs)} total.
        </p>
      )}
    </div>
  );
};
