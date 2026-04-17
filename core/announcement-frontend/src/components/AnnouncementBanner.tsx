import React, { useState, useCallback } from "react";
import { usePluginClient } from "@checkstack/frontend-api";
import {
  AnnouncementApi,
  ANNOUNCEMENT_UPDATED,
  type Announcement,
} from "@checkstack/announcement-common";
import { useSignal } from "@checkstack/signal-frontend";
import { MarkdownBlock } from "@checkstack/ui";
import {
  Info,
  AlertTriangle,
  AlertOctagon,
  X,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

const DISMISSED_STORAGE_KEY = "checkstack-dismissed-announcements";

/**
 * Returns a severity-specific icon component.
 */
function SeverityIcon({ severity }: { severity: Announcement["severity"] }) {
  switch (severity) {
    case "critical": {
      return <AlertOctagon className="h-4 w-4 flex-shrink-0" />;
    }
    case "warning": {
      return <AlertTriangle className="h-4 w-4 flex-shrink-0" />;
    }
    default: {
      return <Info className="h-4 w-4 flex-shrink-0" />;
    }
  }
}

/**
 * Returns Tailwind class names for the severity-based banner styling.
 */
function getSeverityStyles(severity: Announcement["severity"]): {
  bg: string;
  text: string;
  border: string;
  dismissHover: string;
} {
  switch (severity) {
    case "critical": {
      return {
        bg: "bg-destructive/10",
        text: "text-destructive",
        border: "border-destructive/20",
        dismissHover: "hover:bg-destructive/20",
      };
    }
    case "warning": {
      return {
        bg: "bg-warning/10",
        text: "text-warning",
        border: "border-warning/20",
        dismissHover: "hover:bg-warning/20",
      };
    }
    default: {
      return {
        bg: "bg-primary/10",
        text: "text-primary",
        border: "border-primary/20",
        dismissHover: "hover:bg-primary/20",
      };
    }
  }
}

/**
 * Get dismissed announcement IDs from localStorage (for anonymous users).
 */
function getLocalDismissedIds(): Set<string> {
  try {
    const stored = localStorage.getItem(DISMISSED_STORAGE_KEY);
    if (!stored) return new Set();
    const ids: unknown = JSON.parse(stored);
    if (Array.isArray(ids)) {
      return new Set(ids.filter((id): id is string => typeof id === "string"));
    }
    return new Set();
  } catch {
    return new Set();
  }
}

/**
 * Add an announcement ID to the localStorage dismissed set.
 */
function saveLocalDismissedId(id: string) {
  const current = getLocalDismissedIds();
  current.add(id);
  localStorage.setItem(DISMISSED_STORAGE_KEY, JSON.stringify([...current]));
}

/**
 * A single banner strip for one announcement.
 */
function BannerItem({
  announcement,
  onDismiss,
}: {
  announcement: Announcement;
  onDismiss: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const styles = getSeverityStyles(announcement.severity);

  // Only show expand toggle if the message is longer than just the title
  const hasExpandableContent = announcement.message.length > 0;

  return (
    <div
      className={`${styles.bg} ${styles.border} border-b px-4 py-2 transition-all duration-200`}
    >
      <div className="flex items-center gap-3 max-w-7xl mx-auto">
        <SeverityIcon severity={announcement.severity} />

        <span className={`text-sm font-medium ${styles.text} flex-1`}>
          {announcement.title}
        </span>

        {hasExpandableContent && (
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className={`${styles.text} p-1 rounded ${styles.dismissHover} transition-colors`}
            aria-label={expanded ? "Collapse details" : "Expand details"}
          >
            {expanded ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </button>
        )}

        <button
          type="button"
          onClick={() => onDismiss(announcement.id)}
          className={`${styles.text} p-1 rounded ${styles.dismissHover} transition-colors`}
          aria-label="Dismiss announcement"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {expanded && hasExpandableContent && (
        <div className="max-w-7xl mx-auto mt-2 pl-7 pb-1">
          <div className="text-sm opacity-90">
            <MarkdownBlock size="sm">{announcement.message}</MarkdownBlock>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Severity sort priority for sorting banners (critical first).
 */
const SEVERITY_ORDER: Record<string, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

/**
 * Global announcement banner component.
 * Renders active banner announcements as slim strips above the navbar.
 *
 * Must be rendered in App.tsx outside of auth-gated areas since it needs
 * to work for unauthenticated users viewing public announcements.
 */
export const AnnouncementBanner: React.FC = () => {
  const announcementClient = usePluginClient(AnnouncementApi);
  const [localDismissedIds, setLocalDismissedIds] = useState<Set<string>>(() =>
    getLocalDismissedIds(),
  );

  const { data, isLoading, refetch } =
    announcementClient.getActiveAnnouncements.useQuery();

  // Refetch own query immediately + invalidate all announcement queries
  // (including the dashboard's includeDismissed variant) for cross-component freshness.
  // oRPC query keys are structured as [[...path], { type, input }].
  useSignal(ANNOUNCEMENT_UPDATED, () => {
    void refetch();
  });

  // Server-side dismiss — extract stable mutate function to avoid re-renders
  const { mutate: dismissOnServer } =
    announcementClient.dismissAnnouncement.useMutation({});

  // Filter to banner-visible announcements
  const bannerAnnouncements = React.useMemo(() => {
    if (!data?.announcements) return [];

    return data.announcements
      .filter((a) => a.displayMode === "banner" || a.displayMode === "both")
      .filter((a) => !localDismissedIds.has(a.id))
      .toSorted(
        (a, b) =>
          (SEVERITY_ORDER[a.severity] ?? 2) - (SEVERITY_ORDER[b.severity] ?? 2),
      );
  }, [data?.announcements, localDismissedIds]);

  const handleDismiss = useCallback(
    (id: string) => {
      // Always save to localStorage (works for anonymous and authenticated)
      saveLocalDismissedId(id);
      setLocalDismissedIds((prev) => {
        const next = new Set(prev);
        next.add(id);
        return next;
      });

      // Also dismiss server-side (fire-and-forget, silently fails for anonymous)
      dismissOnServer({ announcementId: id });
    },
    [dismissOnServer],
  );

  if (isLoading || bannerAnnouncements.length === 0) {
    return <></>;
  }

  return (
    <div className="w-full">
      {bannerAnnouncements.map((announcement) => (
        <BannerItem
          key={announcement.id}
          announcement={announcement}
          onDismiss={handleDismiss}
        />
      ))}
    </div>
  );
};
