/**
 * Generalized config-secret channel for telemetry source instances.
 *
 * A source type's config schema may mark fields `x-secret` (via
 * `configString({ "x-secret": true })` / `configSecret`). Those fields NEVER
 * hold plaintext in the persisted `config` jsonb: they hold the marker
 * `__tlsecret__:<sourceId>:<field>`, and the plaintext lives encrypted at rest
 * in the platform's `InternalSecretsService` (the same AES-GCM store the
 * metricstream scrape-target bearer uses). Markers are resolved just-in-time
 * before a seam (pull/webhook) runs, and are NEVER returned by reads.
 *
 * V1 CONSTRAINT: secret fields must be TOP-LEVEL string fields of the config
 * object. The marker is a plain string, so a `z.string()` (or `configString` /
 * `configSecret`) field parses it back; an x-secret field MUST NOT carry a
 * refinement that rejects the marker string (see the extension-point docs).
 * Nested / array / record secret fields are out of scope for this version.
 *
 * The KEY PARTS and the marker PREFIX are FROZEN: a stored source's secret is
 * keyed by them, so changing either orphans stored values.
 */

import { z } from "zod";
import { getConfigMeta } from "@checkstack/backend-api";
import { isSecretClearSentinel } from "@checkstack/common";
import {
  configSecretMarker,
  isConfigSecretMarker,
  readConfigSecretMarkerId,
} from "@checkstack/secrets-common";
import type { InternalSecretsService } from "@checkstack/secrets-backend";

/**
 * FROZEN marker prefix for a telemetry config secret. The persisted marker
 * format is `__tlsecret__:<sourceId>:<field>` - a channel prefix plus a
 * COMPOSITE secret id `<sourceId>:<field>`. The primitives below are thin
 * wrappers over `@checkstack/secrets-common`'s shared config-secret marker
 * helpers (same channel-prefix contract metricstream's scrape-target secret
 * uses), so the format is single-sourced while staying byte-identical to the
 * previously hand-rolled one (stored source secrets are keyed by it).
 */
export const TELEMETRY_SECRET_MARKER_PREFIX = "__tlsecret__:";

/**
 * FROZEN reserved field name for a signature-verifying webhook's RAW secret.
 *
 * Unlike a config `x-secret` field, this value is NOT a config field: it never
 * appears in the persisted `config` jsonb and is never returned by a read. It is
 * stored encrypted at rest under its OWN internal-secret key (via
 * {@link sourceSecretKeyParts} with this field name) so the platform can recover
 * the plaintext just-in-time to compute an HMAC - the sha256 `webhookSecretHash`
 * alone cannot key an HMAC. Only source types whose webhook seam declares a
 * `signature` descriptor store it; plain-secret types keep hash-only storage.
 * The double-underscore name is deliberately outside the space of ordinary
 * config keys so it can never collide with a `listSecretFields` config secret.
 */
export const WEBHOOK_SECRET_FIELD = "__webhookSecret";

/** FROZEN internal-secret key parts for one source field's secret value. */
export function sourceSecretKeyParts({
  sourceId,
  field,
}: {
  sourceId: string;
  field: string;
}): string[] {
  return ["telemetry", "source", sourceId, field];
}

/** The composite secret id embedded in a marker: `<sourceId>:<field>`. */
function compositeSecretId({
  sourceId,
  field,
}: {
  sourceId: string;
  field: string;
}): string {
  return `${sourceId}:${field}`;
}

/** Build the marker persisted in place of a field's plaintext secret. */
export function secretMarker({
  sourceId,
  field,
}: {
  sourceId: string;
  field: string;
}): string {
  return configSecretMarker(
    TELEMETRY_SECRET_MARKER_PREFIX,
    compositeSecretId({ sourceId, field }),
  );
}

/**
 * Recover `{ sourceId, field }` from a marker. `sourceId` is a UUID (no colon),
 * so the first colon in the composite id splits it from the field name. Returns
 * null when the value is not a well-formed telemetry marker.
 */
export function parseSecretMarker(
  marker: unknown,
): { sourceId: string; field: string } | null {
  if (
    typeof marker !== "string" ||
    !isConfigSecretMarker(TELEMETRY_SECRET_MARKER_PREFIX, marker)
  ) {
    return null;
  }
  const id = readConfigSecretMarkerId(TELEMETRY_SECRET_MARKER_PREFIX, marker);
  const colon = id.indexOf(":");
  if (colon <= 0 || colon >= id.length - 1) return null;
  return { sourceId: id.slice(0, colon), field: id.slice(colon + 1) };
}

/**
 * True only when `value` is THIS row's marker for THIS field: it parses as a
 * marker AND its embedded sourceId matches the row's id AND its embedded field
 * matches the config key it sits under. Recognition is deliberately SCOPED - a
 * value that merely starts with the prefix (a legitimate non-secret config
 * string, or a marker minted for a DIFFERENT source) is treated as a literal,
 * never a marker. An unscoped prefix check would (a) hide a real value on read
 * and (b) delete the field on a missed store lookup - both permanent config
 * corruption.
 */
export function isSecretMarkerFor({
  value,
  sourceId,
  field,
}: {
  value: unknown;
  sourceId: string;
  field: string;
}): boolean {
  const parsed = parseSecretMarker(value);
  return (
    parsed !== null && parsed.sourceId === sourceId && parsed.field === field
  );
}

/**
 * The TOP-LEVEL config keys a source type marks `x-secret`. Unwraps the schema
 * (optional/default/nullable) to reach the object shape; returns `[]` when the
 * config is not a plain object (no secret extraction for such a type).
 */
export function listSecretFields(schema: z.ZodType): string[] {
  const unwrapped = unwrapToObject(schema);
  if (!unwrapped) return [];
  const fields: string[] = [];
  for (const [key, fieldSchema] of Object.entries(unwrapped.shape)) {
    if (getConfigMeta(fieldSchema as z.ZodType)?.["x-secret"] === true) {
      fields.push(key);
    }
  }
  return fields;
}

function unwrapToObject(
  schema: z.ZodType,
): z.ZodObject<z.ZodRawShape> | null {
  const peeled = peelWrappers(schema);
  return peeled instanceof z.ZodObject ? peeled : null;
}

/** Peel optional/default/nullable wrappers, returning the inner schema. */
function peelWrappers(schema: z.ZodType): z.ZodType {
  let current: z.ZodType = schema;
  for (;;) {
    if (current instanceof z.ZodOptional || current instanceof z.ZodNullable) {
      current = current.unwrap() as z.ZodType;
      continue;
    }
    if (current instanceof z.ZodDefault) {
      current = current.def.innerType as z.ZodType;
      continue;
    }
    return current;
  }
}

/**
 * HARD boot-time guard (called at source-type registration): every `x-secret`
 * config field must (1) be a TOP-LEVEL field of the config object and (2) accept
 * the internal secret marker string, so the persisted marker round-trips through
 * a later config parse. A nested secret, or a secret whose schema rejects the
 * marker (e.g. a length/pattern refinement), throws with the offending type +
 * field named - failing at boot rather than silently stranding or plaintext-
 * persisting the value at run time.
 */
export function assertConfigSecretFieldsValid({
  schema,
  label,
}: {
  schema: z.ZodType;
  label: string;
}): void {
  const top = unwrapToObject(schema);
  // A non-object config carries no extractable secret fields; nothing to guard.
  if (!top) return;

  for (const [key, field] of Object.entries(top.shape)) {
    // (1) Reject any x-secret field found BELOW the top level.
    const nested = findNestedSecretPaths(field as z.ZodType, key);
    if (nested.length > 0) {
      throw new Error(
        `telemetry: source type "${label}" declares nested x-secret field(s) ` +
          `[${nested.join(", ")}]. Config secrets must be TOP-LEVEL string fields ` +
          `(the internal-secret marker cannot address nested / array entries).`,
      );
    }

    // (2) A top-level x-secret field must accept the marker string.
    if (getConfigMeta(field as z.ZodType)?.["x-secret"] === true) {
      const probe = `${TELEMETRY_SECRET_MARKER_PREFIX}probe:${key}`;
      if (!(field as z.ZodType).safeParse(probe).success) {
        throw new Error(
          `telemetry: source type "${label}" x-secret field "${key}" rejects the ` +
            `internal secret marker string. An x-secret field must accept a plain ` +
            `string (no refinement that rejects a "${TELEMETRY_SECRET_MARKER_PREFIX}..." value).`,
        );
      }
    }
  }
}

/** Paths of x-secret fields strictly BELOW `node` (nested objects / arrays). */
function findNestedSecretPaths(node: z.ZodType, path: string): string[] {
  const peeled = peelWrappers(node);
  const found: string[] = [];
  if (peeled instanceof z.ZodObject) {
    for (const [key, field] of Object.entries(peeled.shape)) {
      const childPath = `${path}.${key}`;
      if (getConfigMeta(field as z.ZodType)?.["x-secret"] === true) {
        found.push(childPath);
      }
      found.push(...findNestedSecretPaths(field as z.ZodType, childPath));
    }
  } else if (peeled instanceof z.ZodArray) {
    found.push(
      ...findNestedSecretPaths(peeled.element as z.ZodType, `${path}[]`),
    );
  }
  return found;
}

/**
 * Plan the secret side effects of a create/update, WITHOUT touching any store.
 * Given the incoming config, the existing stored config (markers, `undefined`
 * on create), and the type's secret field list, it returns:
 *
 * - `configToStore`: the config to persist, with plaintext secrets replaced by
 *   markers and cleared/omitted secrets removed.
 * - `toStore`: `{ field, value }` plaintexts to write to the internal store.
 * - `toClear`: fields whose stored secret must be deleted.
 *
 * Sentinels on a secret field (per the platform-standard update convention -
 * see `SECRET_CLEAR_SENTINEL` in `@checkstack/common`):
 * - OMITTED (`undefined`) => keep the stored value (re-insert its marker so a
 *   `z.string()` field still parses).
 * - the `SECRET_CLEAR_SENTINEL` (or an explicit `null`) => clear an optional
 *   secret (delete the stored value). The frontend `SecretField` widget emits
 *   the sentinel; `null` is accepted as an equivalent defensive signal.
 * - any other string => set a new plaintext secret.
 *
 * On CREATE (`storedConfig` undefined) an omitted secret simply has no value.
 */
export function partitionSecretsForWrite({
  incomingConfig,
  storedConfig,
  secretFields,
  sourceId,
}: {
  incomingConfig: Record<string, unknown>;
  storedConfig?: Record<string, unknown>;
  secretFields: string[];
  sourceId: string;
}): {
  configToStore: Record<string, unknown>;
  toStore: { field: string; value: string }[];
  toClear: string[];
} {
  const configToStore: Record<string, unknown> = { ...incomingConfig };
  const toStore: { field: string; value: string }[] = [];
  const toClear: string[] = [];

  for (const field of secretFields) {
    const incoming = incomingConfig[field];
    const hadStored = isSecretMarkerFor({
      value: storedConfig?.[field],
      sourceId,
      field,
    });

    if (incoming === undefined) {
      // Keep: re-insert the marker so the persisted config keeps referencing the
      // stored value; absent when nothing was stored.
      if (hadStored) configToStore[field] = secretMarker({ sourceId, field });
      else delete configToStore[field];
      continue;
    }
    if (incoming === null || isSecretClearSentinel(incoming)) {
      // Clear an optional secret.
      if (hadStored) toClear.push(field);
      delete configToStore[field];
      continue;
    }
    if (typeof incoming === "string") {
      toStore.push({ field, value: incoming });
      configToStore[field] = secretMarker({ sourceId, field });
      continue;
    }
    // A non-string value on a secret field is invalid for v1; drop it so the
    // schema parse in the service surfaces the shape error.
    delete configToStore[field];
  }

  return { configToStore, toStore, toClear };
}

/**
 * Strip every secret marker out of a stored config for a read, returning the
 * safe config plus the list of fields that currently hold a stored value.
 * Recognition is SCOPED to `sourceId`, so a legitimate non-secret value that
 * happens to start with the marker prefix survives the read un-stripped.
 */
export function stripSecretsForRead({
  storedConfig,
  sourceId,
}: {
  storedConfig: Record<string, unknown>;
  sourceId: string;
}): {
  config: Record<string, unknown>;
  storedSecretFields: string[];
} {
  const config: Record<string, unknown> = {};
  const storedSecretFields: string[] = [];
  for (const [key, value] of Object.entries(storedConfig)) {
    if (isSecretMarkerFor({ value, sourceId, field: key })) {
      storedSecretFields.push(key);
      continue;
    }
    config[key] = value;
  }
  return { config, storedSecretFields };
}

/**
 * A thin wrapper over `InternalSecretsService` that applies a
 * {@link partitionSecretsForWrite} plan and resolves markers just-in-time.
 * Constructor-injected so tests pass an in-memory store.
 */
export interface SourceSecretStore {
  /** Persist new plaintexts and delete cleared ones for a source. */
  apply(input: {
    sourceId: string;
    toStore: { field: string; value: string }[];
    toClear: string[];
  }): Promise<void>;
  /** Delete every stored secret referenced by a config's markers. */
  clearAll(input: {
    config: Record<string, unknown>;
    sourceId: string;
  }): Promise<void>;
  /**
   * Replace each marker in a stored config with its plaintext. A marker whose
   * stored value is missing is dropped (the config parse then fails for a
   * required field, surfacing the misconfiguration as a run error). Marker
   * recognition is SCOPED to `sourceId`.
   */
  resolve(input: {
    config: Record<string, unknown>;
    sourceId: string;
  }): Promise<Record<string, unknown>>;
  /**
   * Resolve ONE field's stored plaintext secret, or undefined when absent. For
   * the satellite pull capability's just-in-time `capability_secret_request`
   * (the agent asks for a single field over the authenticated socket).
   */
  resolveField(input: {
    sourceId: string;
    field: string;
  }): Promise<string | undefined>;
  /**
   * Store / rotate the RAW webhook secret for a signature-verifying source under
   * the reserved {@link WEBHOOK_SECRET_FIELD} key. Rotating overwrites it, so
   * signatures minted from the old secret stop verifying.
   */
  setWebhookSecret(input: { sourceId: string; secret: string }): Promise<void>;
  /**
   * Resolve the RAW webhook secret (the HMAC key), or undefined when absent.
   * Called just-in-time during signature verification; never logged.
   */
  resolveWebhookSecret(input: {
    sourceId: string;
  }): Promise<string | undefined>;
  /** Delete the stored webhook secret. Idempotent (safe on a plain-secret type). */
  clearWebhookSecret(input: { sourceId: string }): Promise<void>;
}

export function createSourceSecretStore({
  internalSecrets,
}: {
  internalSecrets: InternalSecretsService;
}): SourceSecretStore {
  return {
    async apply({ sourceId, toStore, toClear }) {
      // toStore / toClear are disjoint (partitionSecretsForWrite puts a field in
      // at most one), so the deletes and sets are independent - run in parallel.
      await Promise.all([
        ...toClear.map((field) =>
          internalSecrets.delete({
            parts: sourceSecretKeyParts({ sourceId, field }),
          }),
        ),
        ...toStore.map(({ field, value }) =>
          internalSecrets.set({
            parts: sourceSecretKeyParts({ sourceId, field }),
            value,
          }),
        ),
      ]);
    },

    async clearAll({ config, sourceId }) {
      const fields = Object.keys(config).filter((field) =>
        isSecretMarkerFor({ value: config[field], sourceId, field }),
      );
      await Promise.all(
        fields.map((field) =>
          internalSecrets.delete({
            parts: sourceSecretKeyParts({ sourceId, field }),
          }),
        ),
      );
    },

    async resolve({ config, sourceId }) {
      const resolved: Record<string, unknown> = { ...config };
      const fields = Object.keys(config).filter((field) =>
        isSecretMarkerFor({ value: config[field], sourceId, field }),
      );
      await Promise.all(
        fields.map(async (field) => {
          const plaintext = await internalSecrets.get({
            parts: sourceSecretKeyParts({ sourceId, field }),
          });
          if (plaintext === undefined) delete resolved[field];
          else resolved[field] = plaintext;
        }),
      );
      return resolved;
    },

    async resolveField({ sourceId, field }) {
      return internalSecrets.get({
        parts: sourceSecretKeyParts({ sourceId, field }),
      });
    },

    async setWebhookSecret({ sourceId, secret }) {
      await internalSecrets.set({
        parts: sourceSecretKeyParts({ sourceId, field: WEBHOOK_SECRET_FIELD }),
        value: secret,
      });
    },

    async resolveWebhookSecret({ sourceId }) {
      return internalSecrets.get({
        parts: sourceSecretKeyParts({ sourceId, field: WEBHOOK_SECRET_FIELD }),
      });
    },

    async clearWebhookSecret({ sourceId }) {
      await internalSecrets.delete({
        parts: sourceSecretKeyParts({ sourceId, field: WEBHOOK_SECRET_FIELD }),
      });
    },
  };
}
