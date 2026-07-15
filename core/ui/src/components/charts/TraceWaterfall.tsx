import React, { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "../../utils";
import { usePerformance } from "../PerformanceProvider";
import { VirtualList } from "../VirtualList";
import {
  buildTraceTree,
  collectParentSpanIds,
  flattenVisibleRows,
  formatSpanDuration,
  serviceColorIndex,
  type WaterfallRow,
  type WaterfallSpan,
} from "./TraceWaterfall.logic";

export type { WaterfallSpan, WaterfallSpanStatus } from "./TraceWaterfall.logic";

/**
 * Categorical service palette, one lane color per service. Cycles the shared
 * chart tokens so the waterfall reads as part of the same system in light/dark.
 * `null` (no service) falls back to the muted foreground.
 */
const SERVICE_FILLS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
];

function serviceFill(serviceName: string | null | undefined): string {
  const index = serviceColorIndex(serviceName);
  return index === null ? "hsl(var(--muted-foreground))" : SERVICE_FILLS[index]!;
}

/** Shared grid columns so the axis header and every row line up exactly. */
const GRID_TEMPLATE = "minmax(150px, 32%) 1fr 76px";
/** Fixed row height (px); keeps the virtualizer's estimate exact. */
const ROW_HEIGHT = 30;
/** Per-depth indent of the name column, px. */
const INDENT_PX = 12;

export interface TraceWaterfallProps {
  /** Every span of ONE trace. Capped upstream at 2000 spans by the platform. */
  spans: ReadonlyArray<WaterfallSpan>;
  /** Called when a row is clicked (opens the span detail panel). */
  onSpanClick?: (spanId: string) => void;
  /** The currently selected span (emphasized + scrolled into view). */
  selectedSpanId?: string | null;
  /** Format a duration. Defaults to {@link formatSpanDuration}. */
  formatMs?: (ms: number) => string;
  /** Bounded height for the scroll container. Defaults to `h-[28rem]`. */
  heightClassName?: string;
  className?: string;
}

/**
 * Hierarchical span waterfall for a single distributed trace.
 *
 * Every span sits on ONE shared time axis (trace start to trace end), so a
 * bar's horizontal offset is when it ran and its width is how long it took -
 * the critical path reads straight off the chart. Subtrees collapse/expand from
 * the chevron; the visible nodes are flattened into a virtualized list, so a
 * 2000-span trace stays cheap to scroll and collapsing genuinely shortens the
 * windowed set. Service names get a deterministic color lane, error spans are
 * tinted with the destructive token, and the selected row is emphasized. Motion
 * is gated behind `usePerformance().isLowPower`; bars scale to the container so
 * the page never scrolls horizontally.
 */
export const TraceWaterfall: React.FC<TraceWaterfallProps> = ({
  spans,
  onSpanClick,
  selectedSpanId,
  formatMs = formatSpanDuration,
  heightClassName = "h-[28rem]",
  className,
}) => {
  const { isLowPower } = usePerformance();

  const tree = useMemo(() => buildTraceTree({ spans }), [spans]);
  const allParentIds = useMemo(
    () => collectParentSpanIds({ roots: tree.roots }),
    [tree],
  );
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  const rows = useMemo(
    () => flattenVisibleRows({ roots: tree.roots, collapsed }),
    [tree, collapsed],
  );

  const toggle = (spanId: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(spanId)) next.delete(spanId);
      else next.add(spanId);
      return next;
    });
  };

  const allCollapsed = allParentIds.length > 0 && collapsed.size >= allParentIds.length;
  const collapseAll = (): void => setCollapsed(new Set(allParentIds));
  const expandAll = (): void => setCollapsed(new Set());

  const selectedIndex = useMemo((): number | undefined => {
    if (!selectedSpanId) return;
    const idx = rows.findIndex((r) => r.spanId === selectedSpanId);
    return idx === -1 ? undefined : idx;
  }, [rows, selectedSpanId]);

  if (spans.length === 0) {
    return (
      <div
        role="img"
        aria-label="Trace waterfall: no spans"
        className={cn(
          "flex items-center justify-center rounded-[var(--radius)] border bg-card px-3 py-8 text-sm text-muted-foreground",
          className,
        )}
      >
        No spans in this trace
      </div>
    );
  }

  // Axis ticks at quarters of the trace span.
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => ({
    fraction: f,
    label: formatMs(tree.totalMs * f),
  }));

  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-[var(--radius)] border bg-card",
        className,
      )}
      role="group"
      aria-label={`Trace waterfall, ${tree.spanCount} spans over ${formatMs(tree.totalMs)}`}
    >
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2 border-b px-3 py-1.5">
        <span className="text-xs text-muted-foreground tabular-nums">
          {tree.spanCount} spans · {formatMs(tree.totalMs)}
        </span>
        {allParentIds.length > 0 && (
          <button
            type="button"
            onClick={allCollapsed ? expandAll : collapseAll}
            className="rounded-sm px-1.5 py-0.5 text-xs font-medium text-muted-foreground hover:bg-surface-inset hover:text-foreground"
          >
            {allCollapsed ? "Expand all" : "Collapse all"}
          </button>
        )}
      </div>

      {/* Time axis header (aligned to the bar lane via the shared grid). */}
      <div
        className="grid items-center border-b px-2 py-1"
        style={{ gridTemplateColumns: GRID_TEMPLATE }}
        aria-hidden
      >
        <span className="pl-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Span
        </span>
        <div className="relative h-4">
          {ticks.map((t) => (
            <span
              key={t.fraction}
              className={cn(
                "absolute top-0 font-mono text-[10px] tabular-nums text-muted-foreground",
                t.fraction === 0 && "left-0",
                t.fraction === 1 && "right-0",
              )}
              style={
                t.fraction === 0 || t.fraction === 1
                  ? undefined
                  : { left: `${t.fraction * 100}%`, transform: "translateX(-50%)" }
              }
            >
              {t.label}
            </span>
          ))}
        </div>
        <span className="pr-1 text-right text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Duration
        </span>
      </div>

      <VirtualList
        items={rows}
        getKey={({ item }) => item.spanId}
        estimateSize={() => ROW_HEIGHT}
        scrollToIndex={selectedIndex}
        className={cn("min-h-0", heightClassName)}
        renderItem={({ item }) => (
          <TraceWaterfallRow
            row={item}
            selected={item.spanId === selectedSpanId}
            isLowPower={isLowPower}
            formatMs={formatMs}
            onToggle={toggle}
            onSelect={onSpanClick}
          />
        )}
      />
    </div>
  );
};

interface TraceWaterfallRowProps {
  row: WaterfallRow;
  selected: boolean;
  isLowPower: boolean;
  formatMs: (ms: number) => string;
  onToggle: (spanId: string) => void;
  onSelect?: (spanId: string) => void;
}

const TraceWaterfallRow: React.FC<TraceWaterfallRowProps> = ({
  row,
  selected,
  isLowPower,
  formatMs,
  onToggle,
  onSelect,
}) => {
  const barColor = row.isError ? "hsl(var(--destructive))" : serviceFill(row.span.serviceName);

  return (
    <div
      role={onSelect ? "button" : undefined}
      tabIndex={onSelect ? 0 : undefined}
      onClick={onSelect ? () => onSelect(row.spanId) : undefined}
      onKeyDown={
        onSelect
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect(row.spanId);
              }
            }
          : undefined
      }
      className={cn(
        "grid items-center border-b border-border/40 px-2 text-sm",
        onSelect && "cursor-pointer hover:bg-surface-inset",
        selected && "bg-[hsl(var(--primary)/0.1)] ring-1 ring-inset ring-[hsl(var(--primary)/0.4)]",
      )}
      style={{ gridTemplateColumns: GRID_TEMPLATE, height: ROW_HEIGHT }}
    >
      {/* Name column: indent + chevron + service dot + name/service. */}
      <div
        className="flex min-w-0 items-center gap-1"
        style={{ paddingLeft: row.depth * INDENT_PX }}
      >
        {row.hasChildren ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggle(row.spanId);
            }}
            aria-label={row.collapsed ? "Expand" : "Collapse"}
            className="flex h-4 w-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-surface-inset hover:text-foreground"
          >
            {row.collapsed ? (
              <ChevronRight className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
          </button>
        ) : (
          <span className="h-4 w-4 shrink-0" aria-hidden />
        )}
        <span
          className="h-2.5 w-1 shrink-0 rounded-sm"
          style={{ backgroundColor: barColor }}
          aria-hidden
        />
        <span className="min-w-0 truncate">
          <span
            className={cn(
              "truncate font-medium",
              row.isError ? "text-destructive" : "text-foreground",
            )}
          >
            {row.span.name}
          </span>
          {row.span.serviceName && (
            <span className="ml-1.5 truncate text-xs text-muted-foreground">
              {row.span.serviceName}
            </span>
          )}
        </span>
      </div>

      {/* Bar lane on the shared time axis. */}
      <div className="relative mx-2 h-[14px] rounded-[var(--radius)] bg-[hsl(var(--surface-inset))]">
        <span
          className={cn(
            "absolute top-0 h-[14px] rounded-[var(--radius)]",
            !isLowPower && "transition-[width] duration-200",
          )}
          style={{
            left: `${row.leftFraction * 100}%`,
            width: `${row.widthFraction * 100}%`,
            minWidth: "2px",
            maxWidth: "100%",
            backgroundColor: barColor,
          }}
        />
      </div>

      {/* Duration column. */}
      <span
        className={cn(
          "pr-1 text-right font-mono text-xs tabular-nums",
          row.isError ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {formatMs(row.span.durationMs)}
      </span>
    </div>
  );
};
