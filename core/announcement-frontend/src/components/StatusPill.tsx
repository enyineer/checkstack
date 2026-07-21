import React from "react";
import { cn, pillToneStyles } from "@checkstack/ui";
import type { StatusTone } from "./announcementStatus.logic";

/**
 * Per-tone class sets for pills, dots, and the card left accent stripe.
 * Re-exported from the shared `@checkstack/ui` tone table rather than
 * re-declared here: the local copy silently omitted the blue `info` tone, so
 * every info-severity surface fell back to the neutral grey `unknown` classes.
 */
export const toneStyles = pillToneStyles;

/**
 * A multi-encoded status pill: a colored dot plus a text label, driven by the
 * colorblind-safe status triad.
 */
export function StatusPill({
  tone,
  children,
}: {
  tone: StatusTone;
  children: React.ReactNode;
}) {
  const styles = toneStyles[tone];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
        styles.pill,
      )}
    >
      <span className={cn("size-1.5 rounded-full", styles.dot)} aria-hidden />
      {children}
    </span>
  );
}
