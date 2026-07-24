import React from "react";
import { Layers, Satellite } from "lucide-react";

/**
 * Shared chip styling. Sizing is fully self-contained (explicit font-size AND
 * `leading-none`) so a chip renders identically regardless of the parent's text
 * size — e.g. inside the `text-sm` "Old checks" accordion vs the base-size live
 * list, which otherwise inherit different line-heights and make the chip taller
 * in one context.
 */
const CHIP_CLASS =
  "inline-flex shrink-0 items-center gap-1 rounded-full border border-border/60 bg-surface-inset px-1.5 py-0.5 text-[10px] leading-none text-muted-foreground";

/** The environment chip shown next to a check name in the system overview. */
export const EnvironmentPill: React.FC<{ label: string }> = ({ label }) => (
  <span className={CHIP_CLASS}>
    <Layers className="h-2.5 w-2.5" />
    {label}
  </span>
);

/**
 * The location chip: which place a check was probed FROM (the local core, or a
 * named satellite). Shown only when a check runs from more than one location -
 * see `resolveSliceSourceLabel` - because that is when a row's verdict belongs
 * to one location rather than to the check as a whole.
 *
 * Shares {@link EnvironmentPill}'s chip styling deliberately: both answer a
 * "which slice is this row" question and must read as one family, differing
 * only by icon.
 */
export const SourcePill: React.FC<{ label: string }> = ({ label }) => (
  <span className={CHIP_CLASS}>
    <Satellite className="h-2.5 w-2.5" />
    {label}
  </span>
);
