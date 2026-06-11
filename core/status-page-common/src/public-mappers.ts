/**
 * Generic, domain-free mappers shared by the owning plugins' status-page
 * widgets. The createdBy-strip is the security-critical part: incident /
 * maintenance update timelines carry `createdBy` / `createdByName` (who on the
 * operating team posted the update) — internal identity that MUST NOT reach the
 * public page. Kept here (no domain deps) so every owning plugin strips it the
 * same, tested, way.
 */

export interface InternalUpdate {
  message: string;
  statusChange?: string;
  createdAt: string | Date;
  /** Internal — dropped. */
  createdBy?: string;
  createdByName?: string;
  [k: string]: unknown;
}

export interface PublicUpdate {
  message: string;
  statusChange?: string;
  at: string;
}

/** Strip an update to its public-safe fields (no author identity). */
export function toPublicUpdate(update: InternalUpdate): PublicUpdate {
  return {
    message: update.message,
    ...(update.statusChange === undefined
      ? {}
      : { statusChange: update.statusChange }),
    at:
      update.createdAt instanceof Date
        ? update.createdAt.toISOString()
        : update.createdAt,
  };
}
