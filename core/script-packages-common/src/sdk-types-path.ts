/**
 * Shared contract for the version-keyed `@checkstack/sdk` editor-types HTTP
 * route. The path is shared (build on the frontend, parse on the backend) so
 * the two can never drift - the same pattern as `type-acquisition.ts`.
 *
 * The route serves the running platform release's generated SDK editor
 * bundle (`core/sdk/generated/editor-bundle.d.ts`) as a RAW, HTTP-cacheable
 * handler (not an oRPC procedure, so it can set `Cache-Control`). The path is
 * keyed by the running release version and the response carries
 * `Cache-Control: private, max-age=..., immutable`. A deployment upgrade
 * changes the release version, so a stale version's URL is simply never
 * requested again and the editor never serves stale SDK types.
 *
 * Shape (within the plugin's `/api/script-packages` namespace):
 *
 *   /sdk-types/:releaseVersion
 */

import { z } from "zod";

/** Path prefix (within the plugin namespace) for the SDK editor-types route. */
export const SDK_TYPES_PATH_PREFIX = "/sdk-types";

/**
 * Response shape of the SDK editor-types route: a list of virtual files the
 * editor mounts via `addExtraLib`. Mirrors the type-acquisition closure's
 * `files` shape so the frontend reuses the same mount path.
 */
export const SdkTypesResponseSchema = z.object({
  files: z.array(
    z.object({
      path: z.string(),
      content: z.string(),
    }),
  ),
});

export type SdkTypesResponse = z.infer<typeof SdkTypesResponseSchema>;

/**
 * Build the plugin-relative request path for a release version. Pure; used by
 * the frontend resolver. The version is percent-encoded so any unusual
 * characters round-trip safely as one path segment.
 */
export function buildSdkTypesPath({
  releaseVersion,
}: {
  releaseVersion: string;
}): string {
  return `${SDK_TYPES_PATH_PREFIX}/${encodeURIComponent(releaseVersion)}`;
}

/**
 * Parse a request pathname's trailing `:releaseVersion` segment back into the
 * decoded version. Pure; used by the backend handler. Returns undefined when
 * the path doesn't match (missing, empty, or contains further path segments -
 * a defence against traversal).
 *
 * `pathnameAfterPrefix` is the portion AFTER `SDK_TYPES_PATH_PREFIX` (e.g.
 * `/<version>`), with or without a leading slash.
 */
export function parseSdkTypesPath(
  pathnameAfterPrefix: string,
): { releaseVersion: string } | undefined {
  const trimmed = pathnameAfterPrefix.replace(/^\/+/, "");
  // Exactly one segment: the encoded release version. Reject any further
  // path traversal (an un-encoded slash in the remaining portion).
  if (trimmed.length === 0 || trimmed.includes("/")) return undefined;
  let releaseVersion: string;
  try {
    releaseVersion = decodeURIComponent(trimmed);
  } catch {
    return undefined;
  }
  if (releaseVersion.length === 0) return undefined;
  return { releaseVersion };
}
