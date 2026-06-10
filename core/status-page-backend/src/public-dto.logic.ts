/**
 * Pure mappers from the platform's richer internal shapes into the PUBLIC DTOs.
 * This is the field allow-list: anything not explicitly copied here cannot reach
 * the public page. In particular incident/maintenance updates carry `createdBy`
 * / `createdByName` (who on the operating team posted them) — internal identity
 * that MUST NOT be exposed. These functions strip it, and are unit-tested to
 * pin that guarantee.
 */

export interface InternalUpdate {
  message: string;
  statusChange?: string;
  createdAt: string | Date;
  /** Internal — MUST be dropped. */
  createdBy?: string;
  createdByName?: string;
  [k: string]: unknown;
}

export interface PublicUpdate {
  message: string;
  statusChange?: string;
  at: string;
}

function toIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

/** Strip an update down to its public-safe fields (no author identity). */
export function toPublicUpdate(update: InternalUpdate): PublicUpdate {
  return {
    message: update.message,
    ...(update.statusChange === undefined
      ? {}
      : { statusChange: update.statusChange }),
    at: toIso(update.createdAt),
  };
}

export interface InternalIncident {
  id: string;
  title: string;
  status: string;
  severity: string;
  systemIds: string[];
  createdAt: string | Date;
  updates?: InternalUpdate[];
  [k: string]: unknown;
}

export interface PublicIncidentDto {
  id: string;
  title: string;
  status: string;
  severity: string;
  systems: string[];
  startedAt: string;
  updates: PublicUpdate[];
}

/**
 * Map an incident to its public DTO. `systemLabels` maps a bound systemId to its
 * public label (so internal ids never leak); unknown ids are dropped.
 */
export function toPublicIncident({
  incident,
  systemLabels,
}: {
  incident: InternalIncident;
  systemLabels: Map<string, string>;
}): PublicIncidentDto {
  return {
    id: incident.id,
    title: incident.title,
    status: incident.status,
    severity: incident.severity,
    systems: incident.systemIds
      .map((id) => systemLabels.get(id))
      .filter((label): label is string => label !== undefined),
    startedAt: toIso(incident.createdAt),
    updates: (incident.updates ?? []).map((u) => toPublicUpdate(u)),
  };
}

export interface InternalMaintenance {
  id: string;
  title: string;
  status: string;
  startAt: string | Date;
  endAt: string | Date;
  systemIds: string[];
  updates?: InternalUpdate[];
  [k: string]: unknown;
}

export interface PublicMaintenanceDto {
  id: string;
  title: string;
  status: string;
  startAt: string;
  endAt: string;
  systems: string[];
  updates: PublicUpdate[];
}

export function toPublicMaintenance({
  maintenance,
  systemLabels,
}: {
  maintenance: InternalMaintenance;
  systemLabels: Map<string, string>;
}): PublicMaintenanceDto {
  return {
    id: maintenance.id,
    title: maintenance.title,
    status: maintenance.status,
    startAt: toIso(maintenance.startAt),
    endAt: toIso(maintenance.endAt),
    systems: maintenance.systemIds
      .map((id) => systemLabels.get(id))
      .filter((label): label is string => label !== undefined),
    updates: (maintenance.updates ?? []).map((u) => toPublicUpdate(u)),
  };
}
