import React from "react";
import { Layers } from "lucide-react";

/**
 * The small environment chip shown next to a check name in the system overview.
 * Sizing is fully self-contained (explicit font-size AND `leading-none`) so it
 * renders identically regardless of the parent's text size — e.g. inside the
 * `text-sm` "Old checks" accordion vs the base-size live list, which otherwise
 * inherit different line-heights and make the pill taller in one context.
 */
export const EnvironmentPill: React.FC<{ label: string }> = ({ label }) => (
  <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border/60 bg-surface-inset px-1.5 py-0.5 text-[10px] leading-none text-muted-foreground">
    <Layers className="h-2.5 w-2.5" />
    {label}
  </span>
);
