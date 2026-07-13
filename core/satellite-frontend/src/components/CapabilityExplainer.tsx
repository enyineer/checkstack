import React from "react";
import { cn } from "@checkstack/ui";
import { toCapabilityBadges } from "../lib/capabilities";

export interface CapabilityExplainerProps {
  /** The satellite's advertised capability ids. */
  capabilities: string[];
  className?: string;
}

/**
 * Read-only "what each capability enables" list for the satellite detail /
 * edit surface. Renders a label + one-line explainer per advertised
 * capability; unrecognised ids show their raw id with a generic note so the
 * surface never hides a capability the agent advertised.
 */
export const CapabilityExplainer: React.FC<CapabilityExplainerProps> = ({
  capabilities,
  className,
}) => {
  const badges = toCapabilityBadges(capabilities);

  if (badges.length === 0) {
    return (
      <p className={cn("text-xs text-muted-foreground", className)}>
        This satellite has not advertised any telemetry capabilities. It runs
        health checks only.
      </p>
    );
  }

  return (
    <ul className={cn("space-y-2", className)}>
      {badges.map((badge) => (
        <li key={badge.id} className="flex flex-col gap-0.5">
          <span className="text-sm font-medium text-foreground">
            {badge.label}
          </span>
          <span className="text-xs text-muted-foreground">
            {badge.description ??
              "Advertised by the satellite agent; this version of the UI has no description for it."}
          </span>
        </li>
      ))}
    </ul>
  );
};
