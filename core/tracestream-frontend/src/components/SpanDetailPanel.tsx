import {
  StatusBadge,
  formatDateTime,
  formatSpanDuration,
  type StatusTone,
} from "@checkstack/ui";
import { CircleAlert, CircleCheck, CircleDashed, type LucideIcon } from "lucide-react";
import type { TraceSpan } from "@checkstack/tracestream-common";

export interface SpanDetailPanelProps {
  span: TraceSpan;
}

const statusTone: Record<TraceSpan["statusCode"], StatusTone> = {
  ok: "ok",
  error: "error",
  unset: "neutral",
};

const statusIcon: Record<TraceSpan["statusCode"], LucideIcon> = {
  ok: CircleCheck,
  error: CircleAlert,
  unset: CircleDashed,
};

/**
 * Detail for one selected span: identity, timing and status, then its
 * attributes, resource attributes and events. Rendered inside the trace view's
 * detail pane (desktop) or a Sheet (mobile).
 */
export function SpanDetailPanel({ span }: SpanDetailPanelProps) {
  return (
    <div className="space-y-4">
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="min-w-0 truncate font-semibold text-foreground">
            {span.name}
          </h3>
          <StatusBadge
            tone={statusTone[span.statusCode]}
            icon={statusIcon[span.statusCode]}
            label={span.statusCode}
          />
        </div>
        {span.serviceName && (
          <p className="text-sm text-muted-foreground">{span.serviceName}</p>
        )}
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <Field label="Duration" value={formatSpanDuration(span.durationMs)} />
        <Field label="Kind" value={span.kind} />
        <Field label="Start" value={formatDateTime(span.startTs)} />
        <Field label="End" value={formatDateTime(span.endTs)} />
        <Field label="Span ID" value={span.spanId} mono />
        <Field label="Parent" value={span.parentSpanId ?? "-"} mono />
      </dl>

      {span.statusMessage && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {span.statusMessage}
        </div>
      )}

      <AttributeTable title="Attributes" attributes={span.attributes} />
      <AttributeTable
        title="Resource attributes"
        attributes={span.resourceAttributes}
      />

      {span.events && span.events.length > 0 && (
        <section className="space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Events
          </h4>
          <ul className="space-y-2">
            {span.events.map((event, i) => (
              <li
                key={`${event.name}-${i}`}
                className="rounded-lg border bg-card p-2 text-sm"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-foreground">
                    {event.name}
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {formatDateTime(event.ts)}
                  </span>
                </div>
                {event.attributes && (
                  <AttributeTable attributes={event.attributes} dense />
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={
          mono
            ? "truncate font-mono text-xs text-foreground"
            : "truncate text-foreground"
        }
      >
        {value}
      </dd>
    </div>
  );
}

function AttributeTable({
  title,
  attributes,
  dense,
}: {
  title?: string;
  attributes: Record<string, unknown> | null | undefined;
  dense?: boolean;
}) {
  const entries = Object.entries(attributes ?? {});
  if (entries.length === 0) {
    if (!title) return null;
    return (
      <section className="space-y-1">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h4>
        <p className="text-sm text-muted-foreground">None</p>
      </section>
    );
  }
  return (
    <section className="space-y-1">
      {title && (
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h4>
      )}
      <dl className={dense ? "mt-1 space-y-0.5" : "space-y-0.5"}>
        {entries.map(([key, value]) => (
          <div
            key={key}
            className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-2 text-xs"
          >
            <dt className="truncate font-mono text-muted-foreground">{key}</dt>
            <dd className="min-w-0 break-words font-mono text-foreground">
              {renderValue(value)}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function renderValue(value: unknown): string {
  if (value === null || value === undefined) return "-";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}
