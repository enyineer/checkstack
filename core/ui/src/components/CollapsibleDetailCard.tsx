import { useState, type ReactNode } from "react";
import { ChevronDown, type LucideIcon } from "lucide-react";
import { cn } from "../utils";
import { DetailCard } from "./DetailCard";
import { usePerformance } from "./PerformanceProvider";

export interface CollapsibleDetailCardProps {
  /** Leading icon rendered before the title. */
  icon?: LucideIcon;
  /** Header title (e.g. "Logs", "Dependencies"). */
  title: ReactNode;
  /**
   * Small muted count/summary shown next to the title (e.g. a stream count or
   * total neighbour count). Rendered only when provided.
   */
  count?: ReactNode;
  /**
   * When true (default) the header is a toggle button with a chevron and the
   * body is hidden until expanded. When false the header is static (no toggle,
   * no chevron) and the body always shows - for a card that has nothing to
   * collapse (e.g. an empty-state message).
   */
  collapsible?: boolean;
  /** Initial expanded state when collapsible. Default false (collapsed). */
  defaultExpanded?: boolean;
  /** Card body, revealed when expanded (or always, when not collapsible). */
  children?: ReactNode;
  /** Extra classes merged onto the `DetailCard` surface. */
  className?: string;
  /**
   * Extra classes on the body wrapper. No padding is applied by default so a
   * full-bleed list (edge-to-edge dividers) works out of the box; pass
   * `px-[var(--d-pad)] pb-[var(--d-pad)]` for an inset body.
   */
  bodyClassName?: string;
}

/**
 * The canonical collapsible system-overview card: a `DetailCard` whose header
 * doubles as an expand/collapse toggle (icon + title + optional count +
 * rotating chevron), with the body revealed on demand. Single-sources the
 * header layout so every collapsible card (Dependencies, Logs / Metrics /
 * Traces, ...) is vertically centred and behaves identically - the manual
 * `CardHeader`/`pb-0`/`pb-3` variant drifted and left some headers
 * mis-aligned when collapsed.
 *
 * The chevron transition is gated on `usePerformance().isLowPower` per the
 * performance rule. Renders `DetailCard`, which carries its own opaque
 * background, so it is safe to mount on a page with a decorative backdrop.
 */
export function CollapsibleDetailCard({
  icon: Icon,
  title,
  count,
  collapsible = true,
  defaultExpanded = false,
  children,
  className,
  bodyClassName,
}: CollapsibleDetailCardProps) {
  const { isLowPower } = usePerformance();
  const [expanded, setExpanded] = useState(defaultExpanded);

  const headerInner = (
    <>
      {Icon ? (
        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      ) : null}
      <span className="text-sm font-semibold text-foreground">{title}</span>
      {count == null ? null : (
        <span className="text-sm font-normal text-muted-foreground">
          {count}
        </span>
      )}
      {collapsible ? (
        <ChevronDown
          className={cn(
            "ml-auto h-4 w-4 shrink-0 text-muted-foreground",
            !isLowPower && "transition-transform",
            expanded && "rotate-180",
          )}
          aria-hidden
        />
      ) : null}
    </>
  );

  const showBody = !collapsible || expanded;

  return (
    <DetailCard className={cn("overflow-hidden", className)}>
      {collapsible ? (
        <button
          type="button"
          onClick={() => setExpanded((open) => !open)}
          aria-expanded={expanded}
          className="flex w-full items-center gap-2 p-[var(--d-pad)] text-left"
        >
          {headerInner}
        </button>
      ) : (
        <div className="flex items-center gap-2 p-[var(--d-pad)]">
          {headerInner}
        </div>
      )}
      {showBody && children != null ? (
        <div className={cn(bodyClassName)}>{children}</div>
      ) : null}
    </DetailCard>
  );
}
