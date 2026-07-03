import React from "react";
import { ChevronDown, MoveRight, TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "../../utils";
import { usePerformance } from "../PerformanceProvider";
import { Sparkline, type SparklineTone } from "./Sparkline";
import type { DeltaDirection } from "./chart-math";

/** Tone of the tile's value (tints the value text, never the whole card). */
export type StatTileTone = "ok" | "warn" | "down" | "unknown" | "default";

const valueToneClass: Record<StatTileTone, string> = {
  ok: "text-[hsl(var(--status-ok))]",
  warn: "text-[hsl(var(--status-warn))]",
  down: "text-[hsl(var(--status-down))]",
  unknown: "text-[hsl(var(--status-unknown))]",
  default: "text-foreground",
};

const sentimentClass: Record<"good" | "bad" | "neutral", string> = {
  good: "text-[hsl(var(--status-ok))]",
  bad: "text-[hsl(var(--status-down))]",
  neutral: "text-muted-foreground",
};

const directionIcon: Record<DeltaDirection, React.ComponentType<{ className?: string }>> = {
  up: TrendingUp,
  down: TrendingDown,
  flat: MoveRight,
};

export interface StatTileDelta {
  /** Preformatted change text, e.g. "+12 ms" or "-3%". */
  text: string;
  direction: DeltaDirection;
  /** Whether the change is good/bad news for THIS metric. */
  sentiment: "good" | "bad" | "neutral";
}

export interface StatTileProps {
  label: string;
  /** Preformatted current value, unit included. */
  value: string;
  /** Tints the value text. Defaults to `default` (plain foreground). */
  tone?: StatTileTone;
  /** Optional trend chip next to the value. */
  delta?: StatTileDelta;
  /** Optional word-sized sparkline under the value. */
  sparkline?: {
    values: ReadonlyArray<number | null>;
    tone?: SparklineTone;
    ariaLabel: string;
  };
  /**
   * Optional compact footer under the value for non-numeric histories (e.g. a
   * ribbon). Rendered instead of `sparkline` when both are set.
   */
  footer?: React.ReactNode;
  /** Full title shown on hover (e.g. the qualified collector id). */
  hoverTitle?: string;
  /** Controlled expansion; when set with `onToggleExpand`, the tile is a button. */
  expanded?: boolean;
  onToggleExpand?: () => void;
  /** Expanded body (a full chart). Rendered only while `expanded`. */
  children?: React.ReactNode;
  className?: string;
}

/**
 * Compact metric tile: muted label over a bold `tabular-nums` value, an
 * optional sentiment-colored trend chip (icon + text, never hue alone), and a
 * word-sized sparkline. With `onToggleExpand` the tile becomes a disclosure
 * button whose expanded body renders a full chart below the summary row.
 */
export const StatTile: React.FC<StatTileProps> = ({
  label,
  value,
  tone = "default",
  delta,
  sparkline,
  footer,
  hoverTitle,
  expanded = false,
  onToggleExpand,
  children,
  className,
}) => {
  const { isLowPower } = usePerformance();
  const expandable = onToggleExpand !== undefined;
  const DeltaIcon = delta === undefined ? undefined : directionIcon[delta.direction];

  const summary = (
    <>
      <div className="flex min-w-0 items-start justify-between gap-2">
        <span
          className="truncate text-xs text-muted-foreground"
          title={hoverTitle}
        >
          {label}
        </span>
        {expandable && (
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 shrink-0 text-muted-foreground",
              !isLowPower && "transition-transform duration-150",
              expanded && "rotate-180",
            )}
            aria-hidden
          />
        )}
      </div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span
          className={cn(
            "text-xl font-bold leading-none tracking-tight tabular-nums",
            valueToneClass[tone],
          )}
        >
          {value}
        </span>
        {delta && DeltaIcon && (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 text-xs font-medium tabular-nums",
              sentimentClass[delta.sentiment],
            )}
          >
            <DeltaIcon className="h-3 w-3" aria-hidden />
            {delta.text}
          </span>
        )}
      </div>
      {footer === undefined ? (
        sparkline && (
          <div className="mt-2">
            <Sparkline
              values={sparkline.values}
              tone={sparkline.tone}
              width={160}
              ariaLabel={sparkline.ariaLabel}
              className="w-full"
            />
          </div>
        )
      ) : (
        <div className="mt-2">{footer}</div>
      )}
    </>
  );

  return (
    <div
      className={cn(
        "rounded-[var(--d-card-r)] border border-border/70 bg-card",
        className,
      )}
    >
      {expandable ? (
        <button
          type="button"
          onClick={onToggleExpand}
          aria-expanded={expanded}
          className={cn(
            "block w-full rounded-[var(--d-card-r)] p-3 text-left",
            "hover:bg-surface-inset focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            !isLowPower && "transition-colors",
          )}
        >
          {summary}
        </button>
      ) : (
        <div className="p-3">{summary}</div>
      )}
      {expandable && expanded && children !== undefined && (
        <div
          className={cn(
            "border-t border-border/60 p-3",
            !isLowPower && "animate-in fade-in duration-150",
          )}
        >
          {children}
        </div>
      )}
    </div>
  );
};
