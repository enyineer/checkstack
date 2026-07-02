import { SECRET_TEMPLATE_REGEX } from "@checkstack/secrets-common";

/**
 * Marker/reference vocabulary for health-check config secrets, shared by the
 * core backend (extract/inflate/redact) and the satellite runtime (detecting
 * which `x-secret` fields need just-in-time resolution from core).
 *
 * A stored config's `x-secret` field holds exactly one of:
 * - an INTERNAL MARKER (`__hcsecret__:<fieldPath>`) for an operator-typed
 *   inline value extracted into the internal secret store,
 * - a `${{ secrets.NAME }}` REFERENCE resolved through the active secrets
 *   backend at run time, or
 * - a LEGACY bare literal (pre-backfill rows only).
 */
export const HEALTHCHECK_SECRET_MARKER_PREFIX = "__hcsecret__:";

export function healthcheckSecretMarker(fieldPath: string): string {
  return `${HEALTHCHECK_SECRET_MARKER_PREFIX}${fieldPath}`;
}

export function isHealthcheckSecretMarker(value: string): boolean {
  return value.startsWith(HEALTHCHECK_SECRET_MARKER_PREFIX);
}

export function healthcheckSecretFieldPath(marker: string): string {
  return marker.slice(HEALTHCHECK_SECRET_MARKER_PREFIX.length);
}

/** Whether a string is a `${{ secrets.NAME }}` reference (whole-value). */
export function isSecretReference(value: string): boolean {
  SECRET_TEMPLATE_REGEX.lastIndex = 0;
  return SECRET_TEMPLATE_REGEX.test(value);
}

/**
 * Whether an `x-secret` field value still needs resolution (marker or
 * reference). A legacy bare literal returns false - it is usable verbatim.
 */
export function isUnresolvedConfigSecret(value: string): boolean {
  return isHealthcheckSecretMarker(value) || isSecretReference(value);
}
