import React from "react";
import { cn } from "@checkstack/ui";
import { toneStyles, type StatusTone } from "./healthcheckDisplay.logic";

interface HealthStatusPillProps {
  tone: StatusTone;
  label: string;
  className?: string;
}

/**
 * Multi-encoded status pill shared across the healthcheck surfaces: hue + a
 * leading dot + the text label, driven by the colorblind-safe status triad.
 * Mirrors the premium pill on the SLO objective card so status never reads by
 * color alone.
 */
export const HealthStatusPill: React.FC<HealthStatusPillProps> = ({
  tone,
  label,
  className,
}) => {
  const styles = toneStyles[tone];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
        styles.pill,
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-full", styles.dot)} aria-hidden />
      {label}
    </span>
  );
};
