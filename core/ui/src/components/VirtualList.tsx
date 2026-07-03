import React, { useEffect, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { cn } from "../utils";

export interface VirtualListProps<T> {
  /** Items in render order. */
  items: ReadonlyArray<T>;
  /** Stable key per item (used for React keys and measurement cache). */
  getKey: (props: { item: T; index: number }) => string;
  /** Estimated row height in px (rows are measured after mount). */
  estimateSize: (props: { item: T; index: number }) => number;
  renderItem: (props: { item: T; index: number }) => React.ReactNode;
  /** Rows rendered beyond the viewport on each side. Defaults to 8. */
  overscan?: number;
  /** When set, scrolls the given index into view (e.g. the selected row). */
  scrollToIndex?: number;
  /** The scroll container. Must carry a bounded height via `className`. */
  className?: string;
}

/**
 * Windowed list over `@tanstack/react-virtual`: only the visible rows (plus
 * `overscan`) are mounted, so long run histories stay cheap to scroll. The
 * component owns the scroll container — give it a bounded height through
 * `className` (e.g. `max-h-full`, `h-[32rem]`).
 */
export function VirtualList<T>({
  items,
  getKey,
  estimateSize,
  renderItem,
  overscan = 8,
  scrollToIndex,
  className,
}: VirtualListProps<T>) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => {
      const item = items[index];
      return item === undefined ? 0 : estimateSize({ item, index });
    },
    getItemKey: (index) => {
      const item = items[index];
      return item === undefined ? index : getKey({ item, index });
    },
    overscan,
  });

  useEffect(() => {
    if (scrollToIndex === undefined) return;
    if (scrollToIndex < 0 || scrollToIndex >= items.length) return;
    virtualizer.scrollToIndex(scrollToIndex, { align: "auto" });
  }, [scrollToIndex, items.length, virtualizer]);

  return (
    <div ref={scrollRef} className={cn("overflow-y-auto", className)}>
      <div
        className="relative w-full"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const item = items[virtualRow.index];
          if (item === undefined) return;
          return (
            <div
              key={virtualRow.key}
              ref={virtualizer.measureElement}
              data-index={virtualRow.index}
              className="absolute left-0 top-0 w-full"
              style={{ transform: `translateY(${virtualRow.start}px)` }}
            >
              {renderItem({ item, index: virtualRow.index })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
