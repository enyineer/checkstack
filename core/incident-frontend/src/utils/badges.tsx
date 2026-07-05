import React from "react";
import { cn } from "@checkstack/ui";
import type {
  IncidentStatus,
  IncidentSeverity,
  IncidentHealthOverride,
} from "@checkstack/incident-common";
import {
  presentIncidentStatus,
  presentIncidentSeverity,
  presentIncidentHealthOverride,
  toneStyles,
  type StatusTone,
} from "./badges.logic";

export {
  getIncidentSeverityAccentClass,
  presentIncidentStatus,
  presentIncidentSeverity,
  incidentSeverityRank,
  incidentStatusRank,
  type StatusTone,
} from "./badges.logic";

/**
 * A compact, multi-encoded status pill: a tinted chip carrying a small status
 * dot and a text label, so the signal reads by hue, position, and words - never
 * color alone. Used for incident status and severity throughout the plugin.
 */
const StatusPill: React.FC<{ tone: StatusTone; label: string }> = ({
  tone,
  label,
}) => {
  const styles = toneStyles[tone];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
        styles.pill,
      )}
    >
      <span className={cn("size-1.5 rounded-full", styles.dot)} aria-hidden />
      {label}
    </span>
  );
};

/**
 * Returns a styled status pill for the given incident status.
 * Use this utility to ensure consistent status styling across the plugin.
 */
export function getIncidentStatusBadge(
  status: IncidentStatus,
): React.ReactNode {
  const { tone, label } = presentIncidentStatus(status);
  return <StatusPill tone={tone} label={label} />;
}

/**
 * Returns a styled status pill for the given incident severity.
 * Use this utility to ensure consistent severity styling across the plugin.
 */
export function getIncidentSeverityBadge(
  severity: IncidentSeverity,
): React.ReactNode {
  const { tone, label } = presentIncidentSeverity(severity);
  return <StatusPill tone={tone} label={label} />;
}

/**
 * Returns a styled status pill for an incident's health override (the status it
 * forces onto its affected systems). Tinted like the health triad: degraded is
 * warn, unhealthy is down.
 */
export function getIncidentHealthOverrideBadge(
  healthOverride: IncidentHealthOverride,
): React.ReactNode {
  const { tone, label } = presentIncidentHealthOverride(healthOverride);
  return <StatusPill tone={tone} label={label} />;
}
