import React from "react";
import { Badge } from "@checkstack/ui";
import { Clock } from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";

interface DowntimeEvent {
  id: string;
  startTime: Date;
  endTime: Date | null;
  durationSeconds: number | null;
  attributionType: "self" | "upstream";
  upstreamSystemId: string | null;
  upstreamSystemName: string | null;
}

interface DowntimeTimelineProps {
  events: DowntimeEvent[];
}

/**
 * Visual timeline of downtime events with attribution coloring.
 * Shows a chronological list with duration, attribution badge, and timestamps.
 */
export const DowntimeTimeline: React.FC<DowntimeTimelineProps> = ({
  events,
}) => {
  if (events.length === 0) {
    return (
      <div className="text-sm text-muted-foreground text-center py-4">
        No downtime events in the current window
      </div>
    );
  }

  return (
    <div className="relative">
      {/* Timeline line */}
      <div className="absolute left-[11px] top-2 bottom-2 w-px bg-border" />

      <div className="space-y-3">
        {events.map((event) => {
          const isOngoing = event.endTime === null;
          const isSelf = event.attributionType === "self";
          const durationMinutes = event.durationSeconds
            ? Math.round(event.durationSeconds / 60)
            : undefined;

          return (
            <div key={event.id} className="flex gap-3 relative">
              {/* Timeline dot */}
              <div
                className={`mt-1.5 w-[9px] h-[9px] rounded-full border-2 z-10 shrink-0 ${
                  isOngoing
                    ? "bg-destructive border-destructive animate-pulse"
                    : isSelf
                      ? "bg-destructive/60 border-destructive/60"
                      : "bg-amber-500/60 border-amber-500/60"
                }`}
              />

              {/* Event details */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge
                    variant={isSelf ? "destructive" : "warning"}
                  >
                    {isSelf
                      ? "Self"
                      : `Upstream: ${event.upstreamSystemName ?? event.upstreamSystemId}`}
                  </Badge>
                  {isOngoing && (
                    <Badge variant="destructive">Ongoing</Badge>
                  )}
                  {durationMinutes !== undefined && (
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {durationMinutes < 60
                        ? `${durationMinutes} min`
                        : `${Math.floor(durationMinutes / 60)}h ${durationMinutes % 60}m`}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 mt-1 text-xs text-muted-foreground">
                  <Clock className="w-3 h-3" />
                  <span>
                    {format(new Date(event.startTime), "MMM d, HH:mm")}
                    {event.endTime
                      ? ` → ${format(new Date(event.endTime), "HH:mm")}`
                      : ""}
                  </span>
                  <span className="text-muted-foreground/50">·</span>
                  <span>
                    {formatDistanceToNow(new Date(event.startTime), {
                      addSuffix: true,
                    })}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
