import React from "react";
import { cn, Tooltip } from "@checkstack/ui";
import { toCapabilityBadges } from "../lib/capabilities";

export interface CapabilityBadgesProps {
  /** The satellite's advertised capability ids. */
  capabilities: string[];
  /**
   * When there are no capabilities, render a muted placeholder instead of
   * nothing. Defaults to true; pass false where the caller supplies its own
   * empty affordance.
   */
  showEmpty?: boolean;
  className?: string;
}

/**
 * Compact, wrapping row of capability pills for the satellite list and mobile
 * card. Known capabilities carry a Tooltip explainer (accessible, keyboard
 * focusable); unrecognised ids render as a plain outline pill so version skew
 * degrades gracefully. Purely presentational - the id -> label/description
 * mapping lives in `../lib/capabilities`.
 */
export const CapabilityBadges: React.FC<CapabilityBadgesProps> = ({
  capabilities,
  showEmpty = true,
  className,
}) => {
  const badges = toCapabilityBadges(capabilities);

  if (badges.length === 0) {
    if (!showEmpty) return null;
    return (
      <span className={cn("text-xs text-muted-foreground", className)}>
        None advertised
      </span>
    );
  }

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {badges.map((badge) => {
        const pill = (
          <span
            className={cn(
              "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
              badge.known
                ? "bg-info/10 text-info"
                : "border border-border text-muted-foreground",
            )}
          >
            {badge.label}
          </span>
        );

        return badge.description ? (
          <Tooltip key={badge.id} content={badge.description}>
            {pill}
          </Tooltip>
        ) : (
          <React.Fragment key={badge.id}>{pill}</React.Fragment>
        );
      })}
    </div>
  );
};
