/**
 * Pure presentation logic for the Queue Runtime panel. Keeping the tone
 * resolution out of the React components makes it trivially unit-testable and
 * keeps the markup focused on layout. Status is always multi-encoded (hue +
 * icon + dot + label), never color alone, and driven by the colorblind-safe
 * status triad.
 */

export type CountTone = "default" | "warning" | "danger" | "success";

export interface CountToneStyle {
  /** Status pill background + text classes. */
  pill: string;
  /** Pill dot (and any inline marker) background class. */
  dot: string;
  /** Left accent stripe background class. */
  accent: string;
  /** Icon foreground class. */
  icon: string;
}

/**
 * Per-tone class sets for the KPI tiles. Spelled out as full literal strings
 * (not interpolated) so Tailwind's JIT keeps them. "default" is the non-status
 * tone (Processing) and stays neutral, with no colored dot or accent.
 */
export const countToneStyles: Record<CountTone, CountToneStyle> = {
  default: {
    pill: "bg-muted/40 text-muted-foreground",
    dot: "bg-muted-foreground/50",
    accent: "bg-border/70",
    icon: "text-muted-foreground",
  },
  warning: {
    pill: "bg-status-warn/10 text-status-warn",
    dot: "bg-status-warn",
    accent: "bg-status-warn",
    icon: "text-status-warn",
  },
  danger: {
    pill: "bg-status-down/10 text-status-down",
    dot: "bg-status-down",
    accent: "bg-status-down",
    icon: "text-status-down",
  },
  success: {
    pill: "bg-status-ok/10 text-status-ok",
    dot: "bg-status-ok",
    accent: "bg-status-ok",
    icon: "text-status-ok",
  },
};

/** Returns true when a job has been retried (attempts beyond the first run). */
export const hasRetried = (attempts: number): boolean => attempts > 1;
