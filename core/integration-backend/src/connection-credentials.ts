/**
 * Unified credential resolution for integration connections.
 *
 * Connection credential fields (the provider `connectionSchema`'s `x-secret`
 * fields, declared with `configSecret({ id })`) ride the platform's ONE
 * config-secret extraction channel ({@link ConfigSecretChannel} in
 * `@checkstack/secrets-backend`, shared with health-check configs). This module
 * only BINDS that channel to a connection scope; the extract/inflate logic is
 * the shared implementation, not a per-plugin re-implementation.
 *
 * Two entry forms:
 *   1. Reference: the field holds a `${{ secrets.NAME }}` template, resolved
 *      through the ACTIVE backend (local or Vault) at run time.
 *   2. Inline: an operator-typed value, extracted into an INTERNAL secret on the
 *      local backend and represented in the stored config by a marker.
 *
 * The `__connref__:` marker prefix and the `["connection", providerId,
 * connectionId, secretId]` key are RELEASED and MUST NOT change - existing
 * stored connection configs carry them. Because each provider's secret ids equal
 * their (flat) field names, the id-keyed extraction is byte-compatible with the
 * previously path-keyed data.
 */
import { z } from "zod";
import {
  extractScopeSecrets,
  inflateScopeSecrets,
  deleteScopeSecrets,
  pruneScopeSecrets,
  type ConfigSecretChannel,
  type SecretResolverService,
  type InternalSecretsService,
} from "@checkstack/secrets-backend";
import {
  configSecretMarker,
  isConfigSecretMarker,
} from "@checkstack/secrets-common";

/**
 * RELEASED marker prefix for an extracted inline connection credential. The
 * actual value lives in an internal secret keyed by (providerId, connectionId,
 * secretId). NEVER change this - stored connection configs carry it.
 */
const INTERNAL_REF_PREFIX = "__connref__:";

export function internalRefMarker(secretId: string): string {
  return configSecretMarker(INTERNAL_REF_PREFIX, secretId);
}

export function isInternalRefMarker(value: string): boolean {
  return isConfigSecretMarker(INTERNAL_REF_PREFIX, value);
}

/** Internal-secret name parts for a connection credential field. */
export function connectionSecretParts(input: {
  providerId: string;
  connectionId: string;
  secretId: string;
}): string[] {
  return ["connection", input.providerId, input.connectionId, input.secretId];
}

/** The shared extraction channel bound to one connection. */
function connectionChannel(
  providerId: string,
  connectionId: string,
): ConfigSecretChannel {
  return {
    markerPrefix: INTERNAL_REF_PREFIX,
    keyParts: (secretId) =>
      connectionSecretParts({ providerId, connectionId, secretId }),
  };
}

export interface ConnectionCredentialDeps {
  secretResolver: SecretResolverService;
  internalSecrets: InternalSecretsService;
}

/**
 * Inflate a stored connection config to full credentials by resolving its
 * `x-secret` fields through the shared channel: a reference resolves through the
 * active backend, an internal-ref marker from the local internal store, a bare
 * literal (legacy) passes through. Returns the inflated config plus the resolved
 * credential VALUES (for the run-scoped masking context).
 */
export async function inflateConnectionCredentials(params: {
  providerId: string;
  connectionId: string;
  config: Record<string, unknown>;
  schema: z.ZodTypeAny;
  deps: ConnectionCredentialDeps;
}): Promise<{ config: Record<string, unknown>; values: string[] }> {
  const { providerId, connectionId, config, schema, deps } = params;
  return inflateScopeSecrets({
    channel: connectionChannel(providerId, connectionId),
    schema,
    config,
    internalSecrets: deps.internalSecrets,
    secretResolver: deps.secretResolver,
  });
}

/**
 * Extract INLINE `x-secret` values out of a stored connection config into
 * internal secrets, replacing each with a marker. References and existing
 * markers are left untouched (idempotent). Returns the rewritten config + how
 * many inline values moved.
 */
export async function extractInlineCredentials(params: {
  providerId: string;
  connectionId: string;
  config: Record<string, unknown>;
  schema: z.ZodTypeAny;
  internalSecrets: InternalSecretsService;
}): Promise<{ config: Record<string, unknown>; extracted: number }> {
  const { providerId, connectionId, config, schema, internalSecrets } = params;
  return extractScopeSecrets({
    channel: connectionChannel(providerId, connectionId),
    schema,
    config,
    internalSecrets,
  });
}

/**
 * Delete every internal secret this connection's stored config extracted, so
 * removing the connection does not ORPHAN its credentials. Schema-free (scans
 * the stored markers), idempotent. Call BEFORE deleting the config - the config
 * markers are the only index into the internal secrets.
 */
export async function deleteConnectionCredentials(params: {
  providerId: string;
  connectionId: string;
  config: Record<string, unknown>;
  internalSecrets: InternalSecretsService;
}): Promise<void> {
  const { providerId, connectionId, config, internalSecrets } = params;
  await deleteScopeSecrets({
    channel: connectionChannel(providerId, connectionId),
    config,
    internalSecrets,
  });
}

/**
 * Delete internal secrets ORPHANED by an update: a marker present in the old
 * stored config whose coordinates are gone from the new one (e.g. a field
 * switched from an inline value to a `${{ secrets.NAME }}` reference, or was
 * cleared). Schema-free, idempotent. Returns the number pruned.
 */
export async function pruneConnectionCredentials(params: {
  providerId: string;
  connectionId: string;
  oldConfig: Record<string, unknown>;
  newConfig: Record<string, unknown>;
  internalSecrets: InternalSecretsService;
}): Promise<number> {
  const { providerId, connectionId, oldConfig, newConfig, internalSecrets } =
    params;
  return pruneScopeSecrets({
    channel: connectionChannel(providerId, connectionId),
    oldConfig,
    newConfig,
    internalSecrets,
  });
}
