import React from "react";
import { cn } from "@checkstack/ui";
import { toneStyles, type StatusTone } from "../pages/status-display";

/**
 * A colorblind-safe status pill from the design-system triad: a leading dot
 * plus a text label so status is multi-encoded, never hue-alone.
 */
export const StatusPill: React.FC<{ tone: StatusTone; label: string }> = ({
  tone,
  label,
}) => {
  const style = toneStyles[tone];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
        style.pill,
      )}
    >
      <span className={cn("size-1.5 rounded-full", style.dot)} aria-hidden />
      {label}
    </span>
  );
};
