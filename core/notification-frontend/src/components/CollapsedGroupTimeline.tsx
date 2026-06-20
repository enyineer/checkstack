import { stripMarkdown, formatRelativeTime } from "@checkstack/ui";
import type { Notification } from "@checkstack/notification-common";

interface CollapsedGroupTimelineProps {
  /**
   * The full chronological list of notifications in the group, newest
   * first. The first item (the representative) is rendered above the
   * timeline by the parent, so this component skips it.
   */
  notifications: Notification[];
  variant?: "bell" | "page";
}

/**
 * Compact timeline of older entries in a collapsed notification group.
 * Each row shows the relative time, title, and a one-line body excerpt.
 * The representative (newest) entry is rendered separately by the parent
 * card; this component only renders the historical tail.
 */
export function CollapsedGroupTimeline({
  notifications,
  variant = "bell",
}: CollapsedGroupTimelineProps) {
  const older = notifications.slice(1);
  if (older.length === 0) return <></>;

  const sizeClass = variant === "page" ? "text-sm" : "text-xs";

  return (
    <div
      className={`mt-2 border-l-2 border-border pl-3 space-y-2 ${sizeClass}`}
    >
      {older.map((n) => (
        <div key={n.id} className="flex flex-col gap-0.5">
          <span className="text-muted-foreground">{formatRelativeTime(n.createdAt)}</span>
          <span className="font-medium text-foreground line-clamp-1">
            {n.title}
          </span>
          {n.body && (
            <span className="text-muted-foreground line-clamp-2">
              {stripMarkdown(n.body)}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
