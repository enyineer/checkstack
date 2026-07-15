import { Link } from "react-router-dom";
import { DetailCard, CardHeader, CardTitle, CardContent } from "@checkstack/ui";
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
 * system detail page share identical chrome. Renders the shared `DetailCard`
 * surface (`@checkstack/ui`) so the three cards match every other
 * system-overview card exactly; `DetailCard` carries its OWN opaque background
 * because the detail page renders a grid backdrop a transparent box would let
 * bleed through.
 *
 * Purely presentational: the caller fetches `listStreamsForSystem` (RLAC
 * post-filtered to readable streams) and passes the result plus a
 * route-building `buildHref`.
 */
export function LinkedStreamsCard({
  title,
  icon: Icon,
  streams,
  buildHref,
}: LinkedStreamsCardProps) {
  if (streams.length === 0) return null;

  return (
    <DetailCard className="overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-base font-semibold">{title}</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <ul className="divide-y divide-border/60">
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
      </CardContent>
    </DetailCard>
  );
}
