import React from "react";
import { StatusPill } from "@checkstack/ui";
import type {
  IncidentStatus,
  IncidentSeverity,
  IncidentHealthOverride,
} from "@checkstack/incident-common";
import {
  presentIncidentStatus,
  presentIncidentSeverity,
  presentIncidentHealthOverride,
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
  return <StatusPill tone="neutral">{presentIncidentStatus(status).label}</StatusPill>;
}

/**
 * Returns a styled status pill for the given incident severity.
 * Use this utility to ensure consistent severity styling across the plugin.
 */
export function getIncidentSeverityBadge(
  severity: IncidentSeverity,
): React.ReactNode {
  const { tone, label } = presentIncidentSeverity(severity);
  return <StatusPill tone={tone}>{label}</StatusPill>;
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
  return <StatusPill tone={tone}>{label}</StatusPill>;
}
