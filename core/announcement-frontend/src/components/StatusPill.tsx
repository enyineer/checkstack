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

/** Shared pill geometry, so the toned and neutral variants sit identically. */
const PILL_BASE =
  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium";

/**
 * A multi-encoded status pill: a colored dot plus a text label, driven by the
 * colorblind-safe status triad.
 *
 * Pass `tone="neutral"` for a state that deliberately carries NO hue and is read
 * from its label alone - the announcement lifecycle (Active / Scheduled /
 * Expired / Inactive), which would otherwise compete with the severity hue on
 * the same row. The neutral variant drops the dot: with no hue to encode, a grey
 * dot adds nothing.
 */
export function StatusPill({
  tone,
  children,
}: {
  tone: StatusTone | "neutral";
  children: React.ReactNode;
}) {
  if (tone === "neutral") {
    return (
      <span className={cn(PILL_BASE, "bg-muted text-muted-foreground")}>
        {children}
      </span>
    );
  }

  const styles = toneStyles[tone];
  return (
    <span className={cn(PILL_BASE, styles.pill)}>
      <span className={cn("size-1.5 rounded-full", styles.dot)} aria-hidden />
      {children}
    </span>
  );
}
