import React from "react";
import { Calendar } from "lucide-react";
import { format } from "date-fns";
import { Badge } from "./Badge";
import { EmptyState } from "./EmptyState";

export interface TimelineItem {
  /** Unique identifier for the item */
  id: string;
  /** Date/time of the item for sorting */
  date: Date | string;
}

export interface TimelineProps<T extends TimelineItem> {
  /** Array of timeline items to display */
  items: T[];
  /** Render function for each timeline item's content */
  renderItem: (item: T, index: number) => React.ReactNode;
  /** Optional render function for the dot indicator. Return null to use default dot. */
  renderDot?: (item: T, index: number) => React.ReactNode;
  /** Sort order for items. Defaults to "desc" (newest first) */
  sortOrder?: "asc" | "desc";
  /** Empty state title */
  emptyTitle?: string;
  /** Empty state description */
  emptyDescription?: string;
  /** Maximum height before scrolling (CSS value or Tailwind class) */
  maxHeight?: string;
  /** Whether to show the timeline dots and line. Defaults to true */
  showTimeline?: boolean;
  /** Custom className for the container */
  className?: string;
}

/**
 * A generic timeline component for displaying chronological items.
 * Uses render props for full customization of item content.
 *
 * @example
 * ```tsx
 * <Timeline
 *   items={updates}
 *   renderItem={(update) => (
 *     <div className="p-4 rounded-lg border">
 *       <p>{update.message}</p>
 *       <span className="text-xs text-muted-foreground">
 *         {format(new Date(update.date), "PPpp")}
 *       </span>
 *     </div>
 *   )}
 *   emptyTitle="No updates"
 * />
 * ```
 */
export function Timeline<T extends TimelineItem>({
  items,
  renderItem,
  renderDot,
  sortOrder = "desc",
  emptyTitle = "No items",
  emptyDescription = "No items to display.",
  maxHeight,
  showTimeline = true,
  className = "",
}: TimelineProps<T>): React.ReactElement {
  if (items.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }

  // Sort items by date
  const sortedItems = [...items].toSorted((a, b) => {
    const diff = new Date(b.date).getTime() - new Date(a.date).getTime();
    return sortOrder === "desc" ? diff : -diff;
  });

  const containerClass = maxHeight
    ? `overflow-y-auto ${
        maxHeight.startsWith("max-h-") ? maxHeight : `max-h-[${maxHeight}]`
      }`
    : "";

  const defaultDot = (index: number) => (
    <div
      className={`absolute left-2.5 w-3 h-3 rounded-full border-2 border-background ${
        index === 0 ? "bg-primary" : "bg-muted-foreground/30"
      }`}
    />
  );

  return (
    <div className={`${containerClass} ${className}`.trim()}>
      {showTimeline ? (
        <div className="relative">
          {/* Timeline line */}
          <div className="absolute left-4 top-2 bottom-2 w-0.5 bg-border" />

          <div className="space-y-6">
            {sortedItems.map((item, index) => (
              <div key={item.id} className="relative pl-10">
                {/* Timeline dot */}
                {renderDot ? renderDot(item, index) : defaultDot(index)}
                {renderItem(item, index)}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {sortedItems.map((item, index) => (
            <div key={item.id}>{renderItem(item, index)}</div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Convenience wrapper for status updates (common use case)
// ============================================================================

export interface StatusUpdate<TStatus extends string = string> {
  id: string;
  message: string;
  statusChange?: TStatus;
  createdAt: Date | string;
  createdBy?: string;
}

export interface StatusUpdateTimelineProps<
  TStatus extends string,
  T extends StatusUpdate<TStatus>
> {
  /** Array of status updates to display */
  updates: T[];
  /** Render function for status badge. Receives the exact status type from T. */
  renderStatusBadge?: (status: TStatus) => React.ReactNode;
  /** Empty state title */
  emptyTitle?: string;
  /** Empty state description */
  emptyDescription?: string;
  /** Maximum height before scrolling */
  maxHeight?: string;
  /** Whether to show the timeline dots and line */
  showTimeline?: boolean;
  /** Custom className for the container */
  className?: string;
}

/**
 * A specialized timeline for status updates.
 * Wraps the generic Timeline component with status-update-specific rendering.
 * Uses generics to preserve the status type from the update items.
 */
export function StatusUpdateTimeline<
  TStatus extends string,
  T extends StatusUpdate<TStatus>
>({
  updates,
  renderStatusBadge,
  emptyTitle = "No status updates",
  emptyDescription = "No status updates have been posted yet.",
  maxHeight,
  showTimeline = true,
  className = "",
}: StatusUpdateTimelineProps<TStatus, T>): React.ReactElement {
  const defaultRenderStatusBadge = (status: TStatus) => (
    <Badge variant="secondary">{status}</Badge>
  );

  const renderBadge = renderStatusBadge ?? defaultRenderStatusBadge;

  // Map updates to timeline items (StatusUpdate uses createdAt, TimelineItem uses date)
  const timelineItems = updates.map((update) => ({
    ...update,
    date: update.createdAt,
  }));

  return (
    <Timeline
      items={timelineItems}
      emptyTitle={emptyTitle}
      emptyDescription={emptyDescription}
      maxHeight={maxHeight}
      showTimeline={showTimeline}
      className={className}
      renderItem={(update) => (
        <div
          className={
            showTimeline
              ? "p-4 rounded-lg border border-border bg-muted/20"
              : "p-3 bg-muted/20 rounded-lg border text-sm"
          }
        >
          <div className="flex items-start justify-between gap-2 mb-2">
            <p className="text-foreground">{update.message}</p>
            {update.statusChange && (
              <div className="shrink-0">
                {renderBadge(update.statusChange as TStatus)}
              </div>
            )}
          </div>
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Calendar className="h-3 w-3" />
            <span>
              {format(
                new Date(update.date),
                showTimeline ? "MMM d, yyyy 'at' HH:mm" : "MMM d, HH:mm"
              )}
            </span>
            {update.createdBy && (
              <>
                <span>•</span>
                <span>by {update.createdBy}</span>
              </>
            )}
          </div>
        </div>
      )}
    />
  );
}
