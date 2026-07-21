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
 * color alone.
 *
 * `tone="neutral"` renders it hueless, read from its label alone, and drops the
 * dot - with no hue to encode, a grey dot adds nothing.
 */
const StatusPill: React.FC<{ tone: StatusTone | "neutral"; label: string }> = ({
  tone,
  label,
}) => {
  const base =
    "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium";
  if (tone === "neutral") {
    return (
      <span className={cn(base, "bg-muted text-muted-foreground")}>{label}</span>
    );
  }
  const styles = toneStyles[tone];
  return (
    <span className={cn(base, styles.pill)}>
      <span className={cn("size-1.5 rounded-full", styles.dot)} aria-hidden />
      {label}
    </span>
  );
};

/**
 * The incident's lifecycle status, stated in words on a deliberately NEUTRAL
 * pill.
 *
 * An incident carries TWO dimensions, and only one may own hue: severity
 * answers "how bad is this" and is what a reader scans for, so it keeps the
 * colour (the pill, the row's leading dot, the card's accent stripe). Colouring
 * the lifecycle too put two competing scales on one line - a red
 * "Investigating" beside an amber "Major" reads as a contradiction rather than
 * as two facts.
 *
 * This is also what the PUBLIC status page has always done with the same
 * incident: severity tinted, status on a muted chip. The internal views now
 * agree with it.
 */
export function getIncidentStatusBadge(
  status: IncidentStatus,
): React.ReactNode {
  return <StatusPill tone="neutral" label={presentIncidentStatus(status).label} />;
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
