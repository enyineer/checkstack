/**
 * Pure presentation logic for the Queue Runtime panel. Keeping the tone
 * resolution out of the React components makes it trivially unit-testable and
 * keeps the markup focused on layout. Status is always multi-encoded (hue +
 * icon + dot + label), never color alone, and driven by the colorblind-safe
 * status triad.
 */

import { pillToneStyles } from "@checkstack/ui";

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
 * Per-tone class sets for the KPI tiles. The status tones come from the shared
 * `pillToneStyles` table (the tile's `icon` is the tone's standalone
 * foreground); only "default" is spelled out here.
 */
export const countToneStyles: Record<CountTone, CountToneStyle> = {
  // "default" (Processing) is the non-status tone: it carries NO hue at all, so
  // the shared table has no entry for it. Its muted classes are deliberately
  // softer than the `StatusPill` neutral variant - a KPI tile that is merely
  // reporting throughput must not compete with the tiles that signal trouble.
  default: {
    pill: "bg-muted/40 text-muted-foreground",
    dot: "bg-muted-foreground/50",
    accent: "bg-border/70",
    icon: "text-muted-foreground",
  },
  warning: { ...pillToneStyles.warn, icon: pillToneStyles.warn.text },
  danger: { ...pillToneStyles.down, icon: pillToneStyles.down.text },
  success: { ...pillToneStyles.ok, icon: pillToneStyles.ok.text },
};

/** Returns true when a job has been retried (attempts beyond the first run). */
export const hasRetried = (attempts: number): boolean => attempts > 1;
