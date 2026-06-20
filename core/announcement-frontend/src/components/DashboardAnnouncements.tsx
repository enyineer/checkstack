import React, { useState } from "react";
import { usePluginClient } from "@checkstack/frontend-api";
import { AnnouncementApi, type Announcement } from "@checkstack/announcement-common";
import { MarkdownBlock, cn, usePerformance } from "@checkstack/ui";
import {
  Info,
  AlertTriangle,
  AlertOctagon,
  ChevronDown,
  ChevronUp,
  Megaphone,
} from "lucide-react";
import { severityToTone } from "./announcementStatus.logic";
import { toneStyles } from "./StatusPill";

/**
 * Returns the right icon for a severity level.
 */
function SeverityIcon({
  severity,
  className,
}: {
  severity: Announcement["severity"];
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

/** Human-readable severity label for the pill. */
const SEVERITY_LABELS: Record<Announcement["severity"], string> = {
  critical: "Critical",
  warning: "Warning",
  info: "Info",
};

/**
 * A single compact announcement card with expand/collapse. The collapsed row is
 * multi-encoded: a left accent stripe (hue + position), a leading severity icon,
 * and a severity pill (hue + dot + label) - so severity reads at a glance, not
 * as an afterthought.
 */
function AnnouncementCard({ announcement }: { announcement: Announcement }) {
  const { isLowPower } = usePerformance();
  const [expanded, setExpanded] = useState(false);
  const tone = severityToTone(announcement.severity);
  const styles = toneStyles[tone];

  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-[var(--d-card-r)] border border-border/70 bg-gradient-to-b from-surface-2 to-surface shadow-[0_1px_2px_hsl(var(--foreground)/0.04),0_10px_30px_-14px_hsl(var(--foreground)/0.12)]",
        !isLowPower &&
          "transition-all duration-200 group-hover:-translate-y-0.5 group-hover:border-primary/40 group-hover:shadow-xl",
      )}
    >
      <span
        className={cn("absolute inset-y-0 left-0 w-1", styles.accent)}
        aria-hidden
      />
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-3 rounded-[var(--d-card-r)] py-3 pl-5 pr-4 text-left transition-colors hover:bg-surface-inset/60"
      >
        <SeverityIcon
          severity={announcement.severity}
          className={cn("h-4 w-4 flex-shrink-0", styles.text)}
        />
        <span className="flex-1 truncate text-sm font-medium text-foreground">
          {announcement.title}
        </span>
        <span
          className={cn(
            "hidden shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium sm:inline-flex",
            styles.pill,
          )}
        >
          <span className={cn("size-1.5 rounded-full", styles.dot)} aria-hidden />
          {SEVERITY_LABELS[announcement.severity]}
        </span>
        {expanded ? (
          <ChevronUp className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
        )}
      </button>

      {expanded && (
        <div
          className={cn(
            "pb-3 pl-5 pr-4",
            !isLowPower && "animate-in slide-in-from-top-1 duration-200",
          )}
        >
          <div className="text-sm text-muted-foreground">
            <MarkdownBlock size="sm">{announcement.message}</MarkdownBlock>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Dashboard announcement section.
 * Renders inside the Overview section as compact, expandable cards.
 * Only shows when there are active dashboard-mode announcements.
 */
export const DashboardAnnouncements: React.FC = () => {
  const { isLowPower } = usePerformance();
  const announcementClient = usePluginClient(AnnouncementApi);

  // Always refetch on mount so the dashboard shows fresh data when navigated to.
  // Realtime updates arrive via SignalAutoInvalidator on `[["announcement"]]`.
  const { data, isLoading } = announcementClient.getActiveAnnouncements.useQuery(
    { includeDismissed: true },
    { refetchOnMount: "always" },
  );

  const dashboardAnnouncements = React.useMemo(() => {
    if (!data?.announcements) return [];

    return data.announcements.filter(
      (a) => a.displayMode === "dashboard" || a.displayMode === "both",
    );
  }, [data?.announcements]);

  if (isLoading || dashboardAnnouncements.length === 0) {
    return <></>;
  }

  return (
    <section
      className={cn(!isLowPower && "animate-in fade-in duration-300")}
    >
      <div className="flex items-center gap-2 mb-3">
        <Megaphone className="w-4 h-4 text-muted-foreground" />
        <h3 className="text-sm font-medium text-muted-foreground">
          Announcements
        </h3>
      </div>
      <div className="space-y-2">
        {dashboardAnnouncements.map((announcement) => (
          <AnnouncementCard
            key={announcement.id}
            announcement={announcement}
          />
        ))}
      </div>
    </section>
  );
};
