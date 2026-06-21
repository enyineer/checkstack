import React from "react";
import { cn } from "@checkstack/ui";
import type { StatusTone } from "./announcementStatus.logic";

/**
 * Per-tone class sets for pills, dots, and the card left accent stripe. Spelled
 * out as full literal strings (never interpolated) so Tailwind's JIT keeps them,
 * and driven by the colorblind-safe status triad.
 */
export const toneStyles: Record<
  StatusTone,
  { pill: string; dot: string; accent: string; text: string }
> = {
  ok: {
    pill: "bg-status-ok/10 text-status-ok",
    dot: "bg-status-ok",
    accent: "bg-status-ok",
    text: "text-status-ok",
  },
  warn: {
    pill: "bg-status-warn/10 text-status-warn",
    dot: "bg-status-warn",
    accent: "bg-status-warn",
    text: "text-status-warn",
  },
  down: {
    pill: "bg-status-down/10 text-status-down",
    dot: "bg-status-down",
    accent: "bg-status-down",
    text: "text-status-down",
  },
  unknown: {
    pill: "bg-status-unknown/10 text-status-unknown",
    dot: "bg-status-unknown",
    accent: "bg-status-unknown",
    text: "text-status-unknown",
  },
};

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
