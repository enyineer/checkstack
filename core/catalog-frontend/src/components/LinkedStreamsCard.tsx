import { Link } from "react-router-dom";
import { CollapsibleDetailCard } from "@checkstack/ui";
import { ChevronRight, type LucideIcon } from "lucide-react";

/** One linked stream row (stream id + display name). */
export interface LinkedStreamItem {
  id: string;
  name: string;
}

export interface LinkedStreamsCardProps {
  /** Section title, e.g. "Logs" / "Metrics" / "Traces". */
  title: string;
  /** Lucide icon rendered next to the title. */
  icon: LucideIcon;
  /**
   * Linked streams to list. The card renders `null` when this is empty, so a
   * system with no linked streams of this signal shows nothing (no empty
   * chrome). Callers can mount it unconditionally.
   */
  streams: LinkedStreamItem[];
  /** Builds the detail-page href for a stream id (via the plugin's routes). */
  buildHref: (streamId: string) => string;
}

/**
 * Shared presentational card listing a system's EXPLICITLY linked streams for
 * one signal, embedded by every stream plugin's `SystemDetailsSlot` filler
 * (logstream / metricstream / tracestream) so the three cards on a single
 * system detail page share identical chrome. Renders the shared
 * `CollapsibleDetailCard` (`@checkstack/ui`) so the three cards match every
 * other collapsible system-overview card exactly (header layout, vertical
 * centring, chevron behaviour) and carry their own opaque background.
 *
 * Collapsed by default: linked streams are secondary detail, so the card is a
 * compact "<title> N" summary until opened, keeping the overview column short.
 *
 * Purely presentational: the caller fetches `listStreamsForSystem` (RLAC
 * post-filtered to readable streams) and passes the result plus a
 * route-building `buildHref`.
 */
export function LinkedStreamsCard({
  title,
  icon,
  streams,
  buildHref,
}: LinkedStreamsCardProps) {
  if (streams.length === 0) return null;

  return (
    <CollapsibleDetailCard icon={icon} title={title} count={streams.length}>
      <ul className="divide-y divide-border/60 border-t border-border/60">
        {streams.map((stream) => (
          <li key={stream.id}>
            <Link
              to={buildHref(stream.id)}
              className="flex items-center justify-between gap-2 px-4 py-3 text-sm transition-colors hover:bg-surface-inset"
            >
              <span className="min-w-0 truncate font-medium">
                {stream.name}
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            </Link>
          </li>
        ))}
      </ul>
    </CollapsibleDetailCard>
  );
}
