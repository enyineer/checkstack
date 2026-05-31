/**
 * Shared contract for the lazy package-type Automatic Type Acquisition
 * (ATA) HTTP route. The path is shared so the backend handler and the
 * frontend resolver can never drift.
 *
 * The route is served as a RAW, HTTP-cacheable handler (not an oRPC
 * procedure) so the browser caches each closure per-install: the path is
 * keyed by the current `lockfileHash`, and the response carries
 * `Cache-Control: private, max-age=..., immutable`. A new install changes
 * the hash, so a stale install's URL is simply never requested again.
 *
 * Shape (within the plugin's `/api/script-packages` namespace):
 *
 *   /types/:lockfileHash/:encodedSpecifier
 *
 * The specifier is percent-encoded so scoped names (`@babel/core`) survive
 * the path segment.
 */

/** Path prefix (within the plugin namespace) for the ATA route. */
export const TYPE_ACQUISITION_PATH_PREFIX = "/types";

/**
 * Build the plugin-relative request path for a specifier + lockfile hash.
 * Pure; used by the frontend resolver. The specifier is percent-encoded so
 * scoped packages (`@scope/name`) round-trip safely as one path segment.
 */
export function buildTypeAcquisitionPath({
  lockfileHash,
  specifier,
}: {
  lockfileHash: string;
  specifier: string;
}): string {
  return `${TYPE_ACQUISITION_PATH_PREFIX}/${encodeURIComponent(
    lockfileHash,
  )}/${encodeURIComponent(specifier)}`;
}

/**
 * Parse a request pathname's trailing `:lockfileHash/:encodedSpecifier`
 * segments back into the hash + decoded specifier. Pure; used by the
 * backend handler. Returns undefined when the path doesn't match.
 *
 * `pathnameAfterPrefix` is the portion AFTER `TYPE_ACQUISITION_PATH_PREFIX`
 * (e.g. `/<hash>/<encodedSpec>`), with or without a leading slash.
 */
export function parseTypeAcquisitionPath(
  pathnameAfterPrefix: string,
): { lockfileHash: string; specifier: string } | undefined {
  const trimmed = pathnameAfterPrefix.replace(/^\/+/, "");
  // Exactly two segments: hash / encoded-specifier. A scoped specifier is a
  // single encoded segment (its `/` is percent-encoded), so we split on the
  // FIRST slash only.
  const slash = trimmed.indexOf("/");
  if (slash <= 0 || slash === trimmed.length - 1) return undefined;
  const lockfileHash = trimmed.slice(0, slash);
  const encodedSpecifier = trimmed.slice(slash + 1);
  // Reject further path traversal: the specifier segment must not itself
  // contain an un-encoded slash.
  if (encodedSpecifier.includes("/")) return undefined;
  let specifier: string;
  try {
    specifier = decodeURIComponent(encodedSpecifier);
  } catch {
    return undefined;
  }
  if (lockfileHash.length === 0 || specifier.length === 0) return undefined;
  return { lockfileHash, specifier };
}
