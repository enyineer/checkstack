import React, { useState } from "react";
import { usePluginClient } from "@checkstack/frontend-api";
import { AnnouncementApi, ANNOUNCEMENT_UPDATED, type Announcement } from "@checkstack/announcement-common";
import { useSignal } from "@checkstack/signal-frontend";
import { MarkdownBlock } from "@checkstack/ui";
import {
  Info,
  AlertTriangle,
  AlertOctagon,
  ChevronDown,
  ChevronUp,
  Megaphone,
} from "lucide-react";

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

/**
 * Severity to border/accent color mapping.
 */
function getSeverityColor(severity: Announcement["severity"]): string {
  switch (severity) {
    case "critical": {
      return "border-l-destructive text-destructive";
    }
    case "warning": {
      return "border-l-warning text-warning";
    }
    default: {
      return "border-l-primary text-primary";
    }
  }
}

/**
 * A single compact announcement card with expand/collapse.
 */
function AnnouncementCard({ announcement }: { announcement: Announcement }) {
  const [expanded, setExpanded] = useState(false);
  const severityColor = getSeverityColor(announcement.severity);
  const [borderClass, textClass] = severityColor.split(" ");

  return (
    <div
      className={`bg-card border border-border rounded-lg border-l-4 ${borderClass} transition-all duration-200`}
    >
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-muted/50 rounded-r-lg transition-colors"
      >
        <SeverityIcon
          severity={announcement.severity}
          className={`h-4 w-4 flex-shrink-0 ${textClass}`}
        />
        <span className="text-sm font-medium text-foreground flex-1 truncate">
          {announcement.title}
        </span>
        {expanded ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        )}
      </button>

      {expanded && (
        <div className="px-4 pb-3 pl-11 animate-in slide-in-from-top-1 duration-200">
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
  const announcementClient = usePluginClient(AnnouncementApi);

  // Always refetch on mount so the dashboard shows fresh data when navigated to.
  // Also subscribe to signals for instant updates while actively viewing.
  const { data, isLoading, refetch } =
    announcementClient.getActiveAnnouncements.useQuery(
      { includeDismissed: true },
      { refetchOnMount: "always" },
    );

  useSignal(ANNOUNCEMENT_UPDATED, () => {
    void refetch();
  });

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
    <section className="animate-in fade-in duration-300">
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
