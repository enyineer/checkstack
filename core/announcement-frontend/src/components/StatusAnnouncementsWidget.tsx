import React from "react";
import {
  AnnouncementsWidgetDtoSchema,
  type AnnouncementSeverity,
} from "@checkstack/announcement-common";
import { MarkdownBlock, StatusPill, cn } from "@checkstack/ui";
import type { StatusWidgetRendererProps } from "@checkstack/status-page-common";
import { Info, AlertTriangle, AlertOctagon, Megaphone } from "lucide-react";
import { severityToTone } from "./announcementStatus.logic";
import { toneStyles } from "./StatusPill";

/**
 * PURE, prop-only status-page renderer for the announcement widget. Like every
 * status-page widget renderer it receives the already-resolved, field-allow-
 * listed DTO as `data` and makes no data call of its own - that is what keeps a
 * public widget unable to leak internal data.
 */

const SEVERITY_LABELS: Record<AnnouncementSeverity, string> = {
  critical: "Critical",
  warning: "Warning",
  info: "Info",
};

function SeverityIcon({
  severity,
  className,
}: {
  severity: AnnouncementSeverity;
  className?: string;
}) {
  switch (severity) {
    case "critical": {
      return <AlertOctagon className={className} />;
    }
    case "warning": {
      return <AlertTriangle className={className} />;
    }
    default: {
      return <Info className={className} />;
    }
  }
}

export const StatusAnnouncementsWidget: React.FC<StatusWidgetRendererProps> = ({
  data,
  label,
}) => {
  const parsed = AnnouncementsWidgetDtoSchema.safeParse(data);
  if (!parsed.success || parsed.data.announcements.length === 0) return null;
  return (
    <section className="overflow-hidden rounded-[var(--d-card-r)] border border-border bg-surface shadow-[0_1px_2px_hsl(var(--foreground)/0.04),0_10px_30px_-14px_hsl(var(--foreground)/0.12)]">
      <div className="flex items-center gap-2 border-b border-border bg-surface-2 px-5 py-3">
        <Megaphone className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {label ?? "Announcements"}
        </h3>
      </div>
      <div className="space-y-3 p-5">
        {parsed.data.announcements.map((a, i) => {
          const styles = toneStyles[severityToTone(a.severity)];
          return (
            <article
              key={i}
              className="relative overflow-hidden rounded-[var(--d-card-r)] border border-border/70 bg-gradient-to-b from-surface-2 to-surface p-[var(--d-pad)] shadow-[0_1px_2px_hsl(var(--foreground)/0.04),0_10px_30px_-14px_hsl(var(--foreground)/0.12)]"
            >
              <span
                aria-hidden
                className={cn("absolute inset-y-0 left-0 w-1", styles.accent)}
              />
              <div className="pl-2">
                <div className="flex flex-wrap items-center gap-2">
                  <SeverityIcon
                    severity={a.severity}
                    className={cn("h-4 w-4 shrink-0", styles.text)}
                  />
                  <h4 className="font-semibold">{a.title}</h4>
                  <StatusPill tone={severityToTone(a.severity)} size="sm">
                    {SEVERITY_LABELS[a.severity]}
                  </StatusPill>
                </div>
                <div className="mt-2 text-sm text-muted-foreground">
                  <MarkdownBlock size="sm">{a.message}</MarkdownBlock>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
};
