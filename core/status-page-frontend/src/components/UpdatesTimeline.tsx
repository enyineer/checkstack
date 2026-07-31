import React from "react";
import {
  MarkdownBlock,
  pillToneStyles,
  resolveEffectiveStatuses,
  type MentionResolver,
  type StatusPillTone,
} from "@checkstack/ui";
import { formatAt } from "../utils/formatAt";
import {
  incidentStatusLabel,
  incidentStatusTone,
} from "../utils/incidentStatusTone";
import {
  maintenanceStatusLabel,
  maintenanceStatusTone,
} from "../utils/maintenanceStatusTone";

/**
 * The chronological "history" of an incident / maintenance: one entry per
 * posted update, oldest rail-dot at the top.
 *
 * Lives here rather than in each caller because the status page's event
 * widgets and the public detail pages render the SAME history and had drifted
 * into two near-identical copies - which is how the same two rendering bugs
 * shipped in both.
 */

export type PublicUpdate = {
  message: string;
  statusChange?: string;
  at: string;
};

/**
 * Maps an update's `statusChange` (a raw incident / maintenance status) to its
 * tone + label, so the timeline colours the status line by domain. Incidents
 * pass the incident mapping, maintenance the maintenance one.
 */
export interface StatusChangePresenter {
  tone: (status: string) => StatusPillTone;
  label: (status: string) => string;
}

export const INCIDENT_STATUS_PRESENTER: StatusChangePresenter = {
  tone: incidentStatusTone,
  label: incidentStatusLabel,
};

export const MAINTENANCE_STATUS_PRESENTER: StatusChangePresenter = {
  tone: maintenanceStatusTone,
  label: maintenanceStatusLabel,
};

export const UpdatesTimeline: React.FC<{
  updates: PublicUpdate[];
  status: StatusChangePresenter;
  /**
   * The event's OWN tone - an incident's severity, a maintenance's status -
   * used for entries older than every status change in the published window.
   * See {@link resolveEffectiveStatuses}.
   */
  fallbackTone: StatusPillTone;
  /**
   * Resolves `#` mentions inside the update body. Omitted means "resolve
   * nothing", so mentions render as plain text - the safe default.
   */
  resolveMention?: MentionResolver;
  /** Spacing for the surrounding list; callers set their own density. */
  className?: string;
}> = ({ updates, status, fallbackTone, resolveMention, className }) => {
  // The status IN EFFECT at each entry, so a changeless update keeps the colour
  // of the status still standing rather than dropping to a near-invisible grey.
  const effective = React.useMemo(
    () => resolveEffectiveStatuses(updates.map((u) => u.statusChange)),
    [updates]
  );

  if (updates.length === 0) return null;
  return (
    <ol className={`space-y-4 border-l border-border pl-4 ${className ?? ""}`}>
      {updates.map((u, i) => {
        const inEffect = effective[i];
        const dotTone = inEffect ? status.tone(inEffect) : fallbackTone;
        return (
        <li key={i} className="relative">
          {/* The dot shows the status the event was IN at this point, so the
              rail reads as a coloured history at a glance. An update that
              changes nothing inherits the last status set before it; only an
              entry older than every change in the window falls back to the
              event's own tone. */}
          <span
            className={`absolute -left-[21px] top-1.5 size-2 rounded-full ${pillToneStyles[dotTone].dot}`}
          />
          {u.statusChange && (
            // `block`, NOT `inline-block`: the message below renders as block
            // markdown, and an inline-block label flowed onto the SAME line as
            // the first paragraph with no gap ("IDENTIFIEDWe found the cause").
            // The label owns its own line so the entry reads status -> message
            // -> time.
            <span
              className={`mb-1.5 block text-[11px] font-semibold uppercase tracking-wide ${pillToneStyles[status.tone(u.statusChange)].text}`}
            >
              {status.label(u.statusChange)}
            </span>
          )}
          {/* BLOCK markdown, sanitized by rehype-sanitize inside the component:
              this is the public, anonymous status page, so an authored update
              must render its headings / lists / paragraphs without opening an
              XSS surface. The inline `<Markdown>` was used here before and
              collapsed every paragraph into a `<span>`, so authored formatting
              appeared to be ignored entirely. A `#` mention becomes a link only
              when the page also publishes the referenced item. */}
          <MarkdownBlock
            size="sm"
            className="text-foreground"
            {...(resolveMention ? { resolveMention } : {})}
          >
            {u.message}
          </MarkdownBlock>
          <p className="mt-1.5 text-[11px] tabular-nums text-muted-foreground">
            {formatAt(u.at)}
          </p>
        </li>
        );
      })}
    </ol>
  );
};
