import * as React from "react";
import { cn } from "../utils";

export type StatusTone = "ok" | "warn" | "error" | "info" | "neutral";

const toneClass: Record<StatusTone, string> = {
  ok: "bg-success/10 text-success",
  warn: "bg-warning/10 text-warning",
  error: "bg-destructive/10 text-destructive",
  info: "bg-info/10 text-info",
  neutral: "bg-secondary text-secondary-foreground",
};

/**
 * Severity sort order via CSS flex `order`, so the most urgent signal always
 * sits left regardless of plugin registration order: error (red) -> warn
 * (yellow) -> info -> neutral -> ok. Only takes effect when badges share a
 * flex container (every `SystemStateBadgesSlot` render site wraps them in one).
 */
const orderClass: Record<StatusTone, string> = {
  error: "order-1",
  warn: "order-2",
  info: "order-3",
  neutral: "order-4",
  ok: "order-5",
};

export interface StatusBadgeProps {
  /** Severity tone driving the (subtle, tinted) color. */
  tone: StatusTone;
  /** Lucide-style icon component. */
  icon: React.ComponentType<{ className?: string }>;
  /** Full description: shown on hover/focus and exposed to assistive tech. */
  label: string;
  className?: string;
}

/**
 * A compact, uniform status symbol: a small tinted chip holding an icon, with
 * the full label revealed on hover/focus (and via `aria-label`). All system
 * state badges (health, incident, SLO, maintenance, anomaly, dependency) render
 * through this so a system's status reads as a tidy, consistent row of icons
 * instead of a stack of differently-styled text pills.
 */
export const StatusBadge: React.FC<StatusBadgeProps> = ({
  tone,
  icon: Icon,
  label,
  className,
}) => {
  return (
    <span
      className={cn(
        "group/status-badge relative inline-flex shrink-0",
        orderClass[tone],
        className,
      )}
    >
      <span
        role="img"
        aria-label={label}
        tabIndex={0}
        className={cn(
          "inline-flex size-6 items-center justify-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring",
          toneClass[tone],
        )}
      >
        <Icon className="h-3.5 w-3.5" />
      </span>
      <span
        role="tooltip"
        className="pointer-events-none invisible absolute bottom-full left-1/2 z-[100] mb-1.5 -translate-x-1/2 whitespace-nowrap rounded border border-border bg-popover px-2 py-1 text-xs text-popover-foreground opacity-0 shadow-lg transition-opacity group-hover/status-badge:visible group-hover/status-badge:opacity-100 group-focus-within/status-badge:visible group-focus-within/status-badge:opacity-100"
      >
        {label}
      </span>
    </span>
  );
};
