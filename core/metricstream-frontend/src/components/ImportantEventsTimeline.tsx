import {
  Timeline,
  StatusBadge,
  formatDateTime,
  cn,
  type StatusTone,
} from "@checkstack/ui";
import type { ImportantEvent } from "@checkstack/metricstream-common";
import { importantEventVisual } from "../lib/event-visual";

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
}

/** `Timeline` requires a `date` field; carry the event's `ts` as that field. */
type TimelineEvent = ImportantEvent & { date: Date };

/**
 * The viewer's important-events timeline: series-cap overflows, failing scrape
 * targets and silence/recovery, each with a type-specific icon and tone.
 */
export function ImportantEventsTimeline({
  events,
}: ImportantEventsTimelineProps) {
  const items: TimelineEvent[] = events.map((e) => ({ ...e, date: e.ts }));
  return (
    <Timeline
      items={items}
      sortOrder="desc"
      emptyTitle="No important events yet"
      emptyDescription="Series-cap overflows, failing scrape targets and silence periods will appear here."
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
        const { tone, icon, label } = importantEventVisual(event.type);
        return (
          <div className="rounded-lg border bg-card p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-foreground">{event.title}</span>
              <StatusBadge tone={tone} icon={icon} label={label} />
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
