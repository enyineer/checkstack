import type {
  InternalSecretsService,
  SecretResolverService,
} from "@checkstack/secrets-backend";
import {
  configSecretMarker,
  isConfigSecretMarker,
  isSecretReference,
} from "@checkstack/secrets-common";

/**
 * Scrape-target bearer-token secret storage.
 *
 * DECISION (mirrors the healthcheck config-secret mechanism, adapted to a
 * single bespoke field): a Prometheus scrape target may carry an optional bearer
 * token, stored ENCRYPTED AT REST via the platform's `InternalSecretsService` -
 * the SAME always-writable local AES-GCM store healthcheck's config-secret
 * channel uses. The `metric_scrape_targets.bearer_token_secret` column NEVER
 * holds plaintext; it holds one of:
 *   - a MARKER `__mssecret__:<targetId>` (an inline token was extracted to an
 *     internal secret keyed by this target), or
 *   - a `${{ secrets.NAME }}` REFERENCE (resolved against the active backend at
 *     scrape time), or
 *   - NULL (no token).
 *
 * We do NOT reuse healthcheck's `ConfigSecretChannel` schema-walk here because a
 * scrape target is a bespoke CRUD resource, not a DynamicForm-driven config with
 * `x-secret` leaves - a single-field helper is the right granularity. The
 * internal-secret KEY PARTS and the marker PREFIX are FROZEN (a released target's
 * secret is keyed by them; changing either orphans stored tokens).
 */

/** FROZEN marker prefix for a metricstream inline secret. */
export const METRICSTREAM_SECRET_MARKER_PREFIX = "__mssecret__:";

/** FROZEN internal-secret key parts for a scrape target's bearer token. */
export function scrapeBearerKeyParts(targetId: string): string[] {
  return ["metricstream", "scrape-target", targetId, "bearerToken"];
}

/**
 * Store an inline bearer token as an encrypted internal secret keyed by the
 * target id, and return the MARKER string to persist in the column. The caller
 * writes the returned marker; the plaintext never touches the row.
 */
export async function storeScrapeTargetBearer({
  internalSecrets,
  targetId,
  value,
}: {
  internalSecrets: InternalSecretsService;
  targetId: string;
  value: string;
}): Promise<string> {
  await internalSecrets.set({ parts: scrapeBearerKeyParts(targetId), value });
  return configSecretMarker(METRICSTREAM_SECRET_MARKER_PREFIX, targetId);
}

/**
 * Delete a target's stored inline bearer secret (best-effort). Call on target
 * delete, and when an update clears or replaces an inline token.
 */
export async function clearScrapeTargetBearer({
  internalSecrets,
  targetId,
}: {
  internalSecrets: InternalSecretsService;
  targetId: string;
}): Promise<void> {
  await internalSecrets.delete({ parts: scrapeBearerKeyParts(targetId) });
}

/**
 * Resolve a stored column value to the plaintext bearer token for an outbound
 * scrape, JUST-IN-TIME. Returns undefined when no token is configured.
 *
 * - MARKER -> read the internal secret keyed by this target.
 * - `${{ secrets.NAME }}` REFERENCE -> resolve via the active backend.
 * - any other non-empty string -> a legacy bare literal (returned as-is).
 *
 * Fail-closed on a marker whose internal secret is missing is the caller's
 * decision; here a missing internal secret returns undefined so the scraper can
 * decide (it should treat the target as misconfigured, not send a blank header).
 */
export async function resolveScrapeTargetBearer({
  stored,
  targetId,
  internalSecrets,
  secretResolver,
}: {
  stored: string | null | undefined;
  targetId: string;
  internalSecrets: InternalSecretsService;
  secretResolver: Pick<SecretResolverService, "resolveForRun">;
}): Promise<string | undefined> {
  if (!stored) return undefined;

  if (isConfigSecretMarker(METRICSTREAM_SECRET_MARKER_PREFIX, stored)) {
    return internalSecrets.get({ parts: scrapeBearerKeyParts(targetId) });
  }

  if (isSecretReference(stored)) {
    const { env } = await secretResolver.resolveForRun({
      secretEnv: { TOKEN: stored },
    });
    return env.TOKEN;
  }

  return stored;
}
