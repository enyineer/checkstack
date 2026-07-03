import React from "react";
import { cn } from "../../utils";

/** Tone of a tooltip row's leading dot. */
export type ChartTooltipTone =
  | "ok"
  | "warn"
  | "down"
  | "unknown"
  | "primary"
  | "muted";

const toneDotClass: Record<ChartTooltipTone, string> = {
  ok: "bg-[hsl(var(--status-ok))]",
  warn: "bg-[hsl(var(--status-warn))]",
  down: "bg-[hsl(var(--status-down))]",
  unknown: "bg-[hsl(var(--status-unknown))]",
  primary: "bg-primary",
  muted: "bg-muted-foreground",
};

/** One label/value line of a chart tooltip. */
export interface ChartTooltipRow {
  /** Stable id (used for keys). */
  id: string;
  label: string;
  /** Preformatted value, unit included. */
  value: string;
  /** Optional tone dot in front of the label. */
  tone?: ChartTooltipTone;
}

export interface ChartTooltipProps {
  /** Optional muted heading, e.g. the hovered bucket's time span. */
  title?: string;
  rows: ReadonlyArray<ChartTooltipRow>;
  /** Optional muted trailing line, e.g. a total. */
  footer?: string;
  className?: string;
}

/**
 * The one chart tooltip: a popover-toned card with an optional title, tone-dot
 * rows, and an optional footer. Purely presentational — positioning and hover
 * hit-testing live in `useBandHover`.
 */
export const ChartTooltip: React.FC<ChartTooltipProps> = ({
  title,
  rows,
  footer,
  className,
}) => {
  return (
    <div
      className={cn(
        "min-w-32 rounded-md border border-border bg-popover p-2 text-xs text-popover-foreground shadow-md",
        className,
      )}
    >
      {title && <p className="mb-1 text-muted-foreground">{title}</p>}
      <div className="space-y-0.5">
        {rows.map((row) => (
          <div key={row.id} className="flex items-center gap-1.5">
            {row.tone && (
              <span
                className={cn(
                  "h-1.5 w-1.5 shrink-0 rounded-full",
                  toneDotClass[row.tone],
                )}
                aria-hidden
              />
            )}
            <span>{row.label}</span>
            <span className="ml-auto pl-3 font-medium tabular-nums">
              {row.value}
            </span>
          </div>
        ))}
      </div>
      {footer && <p className="mt-1 text-muted-foreground">{footer}</p>}
    </div>
  );
};
