import {
  Timeline,
  StatusBadge,
  formatDateTime,
  cn,
  type StatusTone,
} from "@checkstack/ui";
import type { ImportantEvent } from "@checkstack/logstream-common";
import { importantEventVisual } from "../lib/severity-tone";

/** Tinted dot background per tone, mirroring `StatusBadge`'s chip tints. */
const dotToneClass: Record<StatusTone, string> = {
  ok: "bg-success/15 text-success",
  warn: "bg-warning/15 text-warning",
  error: "bg-destructive/15 text-destructive",
  info: "bg-info/15 text-info",
  neutral: "bg-secondary text-secondary-foreground",
};

export interface ImportantEventsTimelineProps {
  events: ImportantEvent[];
  /** Clicking an event deep-links into Explore, pre-filtered to its pattern. */
  onEventClick?: (event: ImportantEvent) => void;
}

/**
 * The viewer's important-events timeline: new patterns, error spikes, silence
 * and recoveries, each with a type-specific icon and tone. Clicking an event
 * jumps to the explorer pre-filtered to the event's pattern and time.
 */
/** `Timeline` requires a `date` field; carry the event's `ts` as that field. */
type TimelineEvent = ImportantEvent & { date: Date };

export function ImportantEventsTimeline({
  events,
  onEventClick,
}: ImportantEventsTimelineProps) {
  const items: TimelineEvent[] = events.map((e) => ({ ...e, date: e.ts }));
  return (
    <Timeline
      items={items}
      sortOrder="desc"
      emptyTitle="No important events yet"
      emptyDescription="New patterns, error spikes and silence periods will appear here."
      maxHeight="max-h-[28rem]"
      renderDot={(event) => {
        const { icon: Icon, tone } = importantEventVisual(event.type);
        return (
          <span
            className={cn(
              "absolute left-1 top-0.5 inline-flex size-6 items-center justify-center rounded-full border-2 border-background",
              dotToneClass[tone],
            )}
          >
            <Icon className="size-3.5" aria-hidden />
          </span>
        );
      }}
      renderItem={(event) => {
        const { tone, label } = importantEventVisual(event.type);
        const clickable = !!onEventClick;
        return (
          <div
            className={cn(
              "rounded-lg border bg-card p-3",
              clickable &&
                "cursor-pointer transition-colors hover:bg-surface-inset focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
            role={clickable ? "button" : undefined}
            tabIndex={clickable ? 0 : undefined}
            onClick={clickable ? () => onEventClick(event) : undefined}
            onKeyDown={
              clickable
                ? (e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onEventClick(event);
                    }
                  }
                : undefined
            }
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-foreground">{event.title}</span>
              <StatusBadge
                tone={tone}
                icon={importantEventVisual(event.type).icon}
                label={label}
              />
            </div>
            <span className="mt-1 block text-xs text-muted-foreground tabular-nums">
              {formatDateTime(event.ts)}
            </span>
          </div>
        );
      }}
    />
  );
}
