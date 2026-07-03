import React from "react";
import { cn } from "../utils";

/** Master column share on `md` and up. Literal class map for Tailwind's JIT. */
const MASTER_WIDTH_CLASS = {
  "1/3": "md:grid-cols-[1fr_2fr]",
  "2/5": "md:grid-cols-[2fr_3fr]",
  "1/2": "md:grid-cols-[1fr_1fr]",
} as const;

export type SplitPaneMasterWidth = keyof typeof MASTER_WIDTH_CLASS;

export interface SplitPaneProps {
  /** The list/index column (left on desktop, the whole view on mobile). */
  master: React.ReactNode;
  /** The detail column. Hidden below `md` — mobile detail is the caller's
   * concern (typically a `Sheet` layered over the master). */
  detail: React.ReactNode;
  /** Master column share on ≥ md. Defaults to "2/5". */
  masterWidth?: SplitPaneMasterWidth;
  /**
   * Sizing/height for the whole split. The default bounds the pane to the
   * viewport (minus typical page chrome) so each column scrolls internally
   * instead of the page.
   */
  className?: string;
}

/**
 * Master-detail split layout: two independently-scrolling columns on desktop,
 * master-only below `md`. Selecting an item never moves the master list —
 * that's the whole point. Purely structural: panes bring their own chrome,
 * and the mobile detail presentation (usually a `Sheet`) is owned by the
 * caller.
 */
export const SplitPane: React.FC<SplitPaneProps> = ({
  master,
  detail,
  masterWidth = "2/5",
  className,
}) => {
  return (
    <div
      className={cn(
        "grid grid-cols-1 gap-4 md:h-[calc(100dvh-14rem)]",
        MASTER_WIDTH_CLASS[masterWidth],
        className,
      )}
    >
      <div className="min-h-0 md:overflow-y-auto">{master}</div>
      <div className="hidden min-h-0 md:block md:overflow-y-auto">{detail}</div>
    </div>
  );
};
