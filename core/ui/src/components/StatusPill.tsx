import * as React from "react";
import { cn } from "../utils";
import {
  neutralToneStyle,
  pillToneStyles,
  type StatusPillTone,
} from "./status-tone";

/**
 * The one status pill. A tinted chip carrying a leading dot and a text label,
 * so a status reads by hue AND position AND words - never by colour alone.
 *
 * This replaces six near-identical local copies (announcements, incidents,
 * maintenance, health checks, notifications, script packages) plus a couple of
 * inline chips, which differed only in whether they took `label` or `children`,
 * whether they forwarded `className`, and whether they set `shrink-0`. They
 * agreed on everything that matters, which is why they collapse cleanly here.
 *
 * Domain plugins should keep their own thin wrapper that maps a domain value to
 * a tone and label (`getIncidentSeverityBadge`, `HealthStatusPill`, ...) and
 * render this underneath - the mapping is domain knowledge, the chip is not.
 */
export interface StatusPillProps {
  /**
   * The tone, or `"neutral"` for a state that deliberately carries NO hue and
   * is read from its label alone.
   *
   * Reach for `"neutral"` when the row already spends its colour on a more
   * important dimension: an incident's lifecycle is neutral because its
   * SEVERITY owns the row's hue. See the "at most one coloured dimension per
   * row" rule on `status-tone.ts`. The neutral variant drops the dot - with no
   * hue to encode, a grey dot adds nothing.
   */
  tone: StatusPillTone | "neutral";
  /**
   * `md` (default) is the standard row/table chip. `sm` is for dense contexts -
   * a public status-page event card, a widget list - where the standard chip
   * crowds the line.
   */
  size?: "sm" | "md";
  className?: string;
  children: React.ReactNode;
}

const SIZE_CLASS = {
  md: "gap-1.5 px-2.5 py-1 text-xs",
  sm: "gap-1 px-2 py-0.5 text-[11px]",
} as const;

export function StatusPill({
  tone,
  size = "md",
  className,
  children,
}: StatusPillProps): React.ReactElement {
  // `shrink-0` unconditionally: a pill squashed by a greedy sibling is
  // unreadable, and its text is the accessible encoding of the status.
  const base = cn(
    "inline-flex shrink-0 items-center rounded-full font-medium",
    SIZE_CLASS[size],
  );

  if (tone === "neutral") {
    return (
      <span className={cn(base, neutralToneStyle.pill, className)}>
        {children}
      </span>
    );
  }

  const styles = pillToneStyles[tone];
  return (
    <span className={cn(base, styles.pill, className)}>
      <span
        className={cn(
          "rounded-full",
          size === "sm" ? "size-1" : "size-1.5",
          styles.dot,
        )}
        aria-hidden
      />
      {children}
    </span>
  );
}
