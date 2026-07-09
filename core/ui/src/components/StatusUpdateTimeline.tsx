import React, { useState } from "react";
import { Calendar, ChevronDown, ChevronRight } from "lucide-react";
import { format } from "date-fns";
import { Badge } from "./Badge";
import { EmptyState } from "./EmptyState";
import { Markdown } from "./Markdown";

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

/**
 * A prior version of a status update, archived when the update was edited in
 * place. Timestamps may be `Date` or ISO string (the wire form is a string).
 */
export interface StatusUpdateEditSnapshot<TStatus extends string = string> {
  message: string;
  statusChange?: TStatus;
  visibility?: string;
  /** The published time this version carried before the edit. */
  createdAt: Date | string;
  /** When this version was superseded (the edit timestamp). */
  editedAt: Date | string;
}

export interface StatusUpdate<TStatus extends string = string> {
  id: string;
  message: string;
  statusChange?: TStatus;
  createdAt: Date | string;
  createdByName?: string;
  /**
   * Set when the update was edited in place (see the edit/delete affordances).
   * Surfaces an "edited" marker in the meta line so the timeline stays honest.
   */
  editedAt?: Date | string | null;
  /**
   * Prior versions of this update, oldest first. Manager-only: the owning plugin
   * only supplies this to managers (the read path strips it otherwise). When
   * present and non-empty, the "edited" marker becomes an expandable disclosure
   * that reveals the history of edits; otherwise a plain "edited" is shown.
   */
  editHistory?: StatusUpdateEditSnapshot<TStatus>[];
}

export interface StatusUpdateTimelineProps<
  TStatus extends string,
  T extends StatusUpdate<TStatus>,
> {
  /** Array of status updates to display */
  updates: T[];
  /** Render function for status badge. Receives the exact status type from T. */
  renderStatusBadge?: (status: TStatus) => React.ReactNode;
  /**
   * Optional per-item metadata rendered in the header row (e.g. a visibility
   * lock/eye badge for internal or logged-in-only updates). Kept generic so
   * the owning plugin decides what to show.
   */
  renderMeta?: (item: T) => React.ReactNode;
  /**
   * Optional per-item action controls (e.g. edit / delete) rendered at the top
   * right of each item. The owning plugin supplies the buttons AND their
   * capability gating, so the timeline stays presentation-only.
   */
  renderActions?: (item: T) => React.ReactNode;
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
  T extends StatusUpdate<TStatus>,
>({
  updates,
  renderStatusBadge,
  renderMeta,
  renderActions,
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
        <StatusUpdateTimelineItem
          update={update}
          showTimeline={showTimeline}
          renderBadge={renderBadge}
          renderMeta={renderMeta}
          renderActions={renderActions}
        />
      )}
    />
  );
}

// ============================================================================
// Single timeline item (its own component so the edit-history disclosure can
// hold local open/closed state without lifting it into the list).
// ============================================================================

interface StatusUpdateTimelineItemProps<
  TStatus extends string,
  T extends StatusUpdate<TStatus> & { date: Date | string },
> {
  update: T;
  showTimeline: boolean;
  renderBadge: (status: TStatus) => React.ReactNode;
  renderMeta?: (item: T) => React.ReactNode;
  renderActions?: (item: T) => React.ReactNode;
}

function StatusUpdateTimelineItem<
  TStatus extends string,
  T extends StatusUpdate<TStatus> & { date: Date | string },
>({
  update,
  showTimeline,
  renderBadge,
  renderMeta,
  renderActions,
}: StatusUpdateTimelineItemProps<TStatus, T>): React.ReactElement {
  const [historyOpen, setHistoryOpen] = useState(false);
  const history = update.editHistory ?? [];
  const hasHistory = history.length > 0;

  return (
    <div
      className={
        showTimeline
          ? "p-4 rounded-lg border border-border bg-muted/20"
          : "p-3 bg-muted/20 rounded-lg border text-sm"
      }
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        {/* Markdown so **bold**, links, and lists in an operator's update
            render as intended. Sanitized inside <Markdown> (rehype-sanitize),
            which matters because this timeline is also reached from the
            public status page. */}
        <Markdown className="text-foreground">{update.message}</Markdown>
        <div className="flex shrink-0 items-center gap-1.5">
          {renderMeta?.(update)}
          {update.statusChange && renderBadge(update.statusChange as TStatus)}
          {renderActions?.(update)}
        </div>
      </div>
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <Calendar className="h-3 w-3" />
        <span>
          {format(
            new Date(update.date),
            showTimeline ? "MMM d, yyyy 'at' HH:mm" : "MMM d, HH:mm",
          )}
        </span>
        {update.createdByName && (
          <>
            <span>•</span>
            <span>by {update.createdByName}</span>
          </>
        )}
        {update.editedAt && (
          <>
            <span>•</span>
            {hasHistory ? (
              // Manager view: the "edited" marker is a disclosure revealing the
              // history of prior versions.
              <button
                type="button"
                onClick={() => setHistoryOpen((o) => !o)}
                aria-expanded={historyOpen}
                className="inline-flex items-center gap-0.5 italic underline decoration-dotted underline-offset-2 hover:text-foreground"
              >
                {historyOpen ? (
                  <ChevronDown className="h-3 w-3" />
                ) : (
                  <ChevronRight className="h-3 w-3" />
                )}
                <span>
                  edited ({history.length})
                </span>
              </button>
            ) : (
              <span className="italic">edited</span>
            )}
          </>
        )}
      </div>

      {hasHistory && historyOpen && (
        <div className="mt-3 space-y-2 border-t border-border/60 pt-3">
          <p className="text-xs font-medium text-muted-foreground">
            Edit history
          </p>
          {/* Newest prior version first so the list reads most-recent-change
              down to the original. */}
          {history.toReversed().map((snapshot, index) => (
            <div
              key={index}
              className="rounded-md border border-border/60 bg-background/40 p-2 text-xs"
            >
              <div className="mb-1 flex flex-wrap items-center gap-1.5 text-muted-foreground">
                <span>
                  {format(
                    new Date(snapshot.editedAt),
                    "MMM d, yyyy 'at' HH:mm",
                  )}
                </span>
                {snapshot.statusChange && (
                  <>
                    <span>•</span>
                    {renderBadge(snapshot.statusChange)}
                  </>
                )}
                {snapshot.visibility && (
                  <>
                    <span>•</span>
                    <span className="capitalize">
                      {snapshot.visibility.replace("_", " ")}
                    </span>
                  </>
                )}
              </div>
              <Markdown className="text-foreground/80">
                {snapshot.message}
              </Markdown>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
