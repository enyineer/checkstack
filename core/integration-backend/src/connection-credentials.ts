/**
 * Unified credential resolution for integration connections.
 *
 * Connection credential fields (the provider `connectionSchema`'s
 * `x-secret` fields) resolve through the ONE secrets channel, two entry
 * forms:
 *
 *   1. Reference form: the field holds a `${{ secrets.NAME }}` template.
 *      It resolves through the ACTIVE backend (local or Vault) via
 *      `secretResolverRef` — so a credential that "originates from Vault"
 *      just works.
 *   2. Inline form: an operator-typed value, extracted into an INTERNAL
 *      secret on the local backend (Vault is read-through / unwritable) and
 *      represented in the stored config by an internal-reference marker.
 *      It resolves via `internalSecretsRef`.
 *
 * Both forms are walked with the shared `walkSecretFields` machinery
 * (acting only on `x-secret` fields) — no per-provider logic is
 * re-implemented. Non-secret config is never touched.
 */
import { z } from "zod";
import {
  SECRET_TEMPLATE_REGEX,
  type SecretEnvMapping,
} from "@checkstack/secrets-common";
import {
  walkSecretFields,
  type SecretResolverService,
  type InternalSecretsService,
} from "@checkstack/secrets-backend";

/**
 * Marker stored in a connection config field for an extracted INLINE
 * credential. The actual value lives in an internal secret keyed by
 * (providerId, connectionId, fieldPath). The marker carries the field path
 * so the inflate can rebuild the internal-secret key.
 */
const INTERNAL_REF_PREFIX = "__connref__:";

export function internalRefMarker(fieldPath: string): string {
  return `${INTERNAL_REF_PREFIX}${fieldPath}`;
}

export function isInternalRefMarker(value: string): boolean {
  return value.startsWith(INTERNAL_REF_PREFIX);
}

function fieldPathFromMarker(marker: string): string {
  return marker.slice(INTERNAL_REF_PREFIX.length);
}

/** Internal-secret name parts for a connection credential field. */
export function connectionSecretParts(input: {
  providerId: string;
  connectionId: string;
  fieldPath: string;
}): string[] {
  return ["connection", input.providerId, input.connectionId, input.fieldPath];
}

/** Whether a string is a `${{ secrets.NAME }}` reference (whole-value). */
function isSecretReference(value: string): boolean {
  SECRET_TEMPLATE_REGEX.lastIndex = 0;
  return SECRET_TEMPLATE_REGEX.test(value);
}

export interface ConnectionCredentialDeps {
  secretResolver: SecretResolverService;
  internalSecrets: InternalSecretsService;
}

/**
 * Inflate a stored connection config to full credentials by resolving its
 * `x-secret` fields through the unified channel. A reference form resolves
 * through the active backend; an internal-ref marker resolves the inline
 * value from the local internal store; a bare literal (legacy, pre-migration)
 * is returned unchanged.
 *
 * Returns the inflated config plus the set of resolved credential VALUES
 * (for registering with the run-scoped masking context).
 */
export async function inflateConnectionCredentials(params: {
  providerId: string;
  connectionId: string;
  config: Record<string, unknown>;
  schema: z.ZodTypeAny;
  deps: ConnectionCredentialDeps;
}): Promise<{ config: Record<string, unknown>; values: string[] }> {
  const { providerId, connectionId, config, schema, deps } = params;
  const values: string[] = [];

  const inflated = await walkSecretFields({
    value: config,
    schema,
    visit: async ({ value }) => {
      let resolved = value;
      if (isInternalRefMarker(value)) {
        const fieldPath = fieldPathFromMarker(value);
        const got = await deps.internalSecrets.get({
          parts: connectionSecretParts({ providerId, connectionId, fieldPath }),
        });
        if (got === undefined) {
          throw new Error(
            `Connection ${connectionId}: internal credential for "${fieldPath}" not found.`,
          );
        }
        resolved = got;
      } else if (isSecretReference(value)) {
        // `${{ secrets.NAME }}` — resolve via the active backend (Vault/local).
        const mapping: SecretEnvMapping = { CRED: value };
        const { env } = await deps.secretResolver.resolveForRun({
          secretEnv: mapping,
        });
        resolved = env.CRED;
      }
      // else: bare literal (legacy) — leave as-is.
      if (resolved.length > 0) values.push(resolved);
      return resolved;
    },
  });

  return { config: inflated as Record<string, unknown>, values };
}

/**
 * Extract INLINE `x-secret` values out of a stored connection config into
 * internal secrets, replacing each with an internal-ref marker. Reference
 * (`${{ secrets.NAME }}`) values and already-extracted markers are left
 * untouched. Returns the rewritten config + how many inline values moved.
 *
 * Used by the one-time migration. Idempotent: re-running over an
 * already-migrated config (markers everywhere) extracts nothing.
 */
export async function extractInlineCredentials(params: {
  providerId: string;
  connectionId: string;
  config: Record<string, unknown>;
  schema: z.ZodTypeAny;
  internalSecrets: InternalSecretsService;
}): Promise<{ config: Record<string, unknown>; extracted: number }> {
  const { providerId, connectionId, config, schema, internalSecrets } = params;
  let extracted = 0;

  const rewritten = await walkSecretFields({
    value: config,
    schema,
    visit: async ({ path, value }) => {
      // Already a marker or a reference — nothing to extract.
      if (isInternalRefMarker(value) || isSecretReference(value)) {
        return value;
      }
      // Empty literal — leave as-is (nothing to protect).
      if (value.length === 0) return value;
      // Inline literal: move it to an internal secret keyed by field path.
      await internalSecrets.set({
        parts: connectionSecretParts({ providerId, connectionId, fieldPath: path }),
        value,
      });
      extracted++;
      return internalRefMarker(path);
    },
  });

  return { config: rewritten as Record<string, unknown>, extracted };
}
