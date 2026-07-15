/**
 * Push-token verification: the READ side of the platform's PUSH source mode.
 *
 * A PUSH source type's OWNING PLUGIN serves an inbound endpoint (OTLP, a native
 * ingest route) and shippers authenticate with a per-instance bearer token the
 * PLATFORM mints (see `service.ts`'s create / `rotatePushToken`). Only the
 * token's sha256 hash is stored (`telemetry_sources.push_token_hash`, indexed);
 * the raw token is shown once. This module lets any endpoint owner turn a
 * presented token into an authorization verdict WITHOUT depending on the
 * platform's schema: it exposes
 *
 *   1. {@link PushTokenVerifier} - a service (resolved cross-plugin through
 *      `telemetryPushTokenVerifierRef`) doing the single indexed hash lookup and
 *      a throttled activity stamp; and
 *   2. {@link createPushTokenLookup} - the PUBLIC adapter that wraps the verifier
 *      into the `@checkstack/ingest-utils` {@link IngestTokenLookup} shape, so an
 *      endpoint owner can build a normal {@link IngestAuthenticator} over push
 *      tokens exactly as it already does over its own native source tokens.
 *
 * Tokens are SCOPED to their source TYPE: a token minted for one push type never
 * verifies for another (the lookup rejects a hash whose row is a different
 * `sourceTypeId`). This keeps the built-in stream plugins ordinary consumers of
 * the same seam a third-party push type uses.
 */

import { eq } from "drizzle-orm";
import type { Logger, SafeDatabase } from "@checkstack/backend-api";
import type {
  IngestTokenLookup,
  IngestTokenRow,
} from "@checkstack/ingest-utils";
import type { SourceBinding, TelemetrySignal } from "@checkstack/telemetry-common";
import * as schema from "./schema";
import { telemetrySources } from "./schema";

type Db = SafeDatabase<typeof schema>;

/**
 * Only stamp a push instance's `lastRunAt` at most this often per source per pod.
 * Pushes arrive continuously, so stamping on every delivery would amplify writes
 * with no operational signal; mirrors the derive dispatcher's success throttle.
 */
export const PUSH_SEEN_STAMP_THROTTLE_MS = 60_000;

/**
 * Result of resolving a push token by hash. A row that exists but is DISABLED is
 * returned with `revoked: true` (distinguishable from an unknown token, which is
 * `null`) so an endpoint owner can answer 401 "revoked" rather than "unknown".
 */
export interface PushTokenLookupResult {
  sourceId: string;
  /** The instance's bindings; the endpoint resolves the stream for its signal. */
  bindings: SourceBinding[];
  enabled: boolean;
  /** True when the instance is disabled (the token no longer authorizes ingest). */
  revoked: boolean;
}

/**
 * Cross-plugin service (resolved through `telemetryPushTokenVerifierRef`) that
 * endpoint-owning plugins consume to verify presented push tokens and record
 * activity. Prefer {@link createPushTokenLookup} to plug it into an
 * {@link IngestAuthenticator}; call {@link PushTokenVerifier.recordPushSeen}
 * after a successful delivery.
 */
export interface PushTokenVerifier {
  /**
   * Resolve a token hash to its owning instance, or null when no instance of
   * `sourceTypeId` holds that hash. A single indexed query on `push_token_hash`;
   * the resolved row MUST match `sourceTypeId` (type scoping) or this returns
   * null so a token minted for another push type reads as unknown.
   */
  lookupPushToken(input: {
    sourceTypeId: string;
    tokenHash: string;
  }): Promise<PushTokenLookupResult | null>;
  /**
   * Throttled, fire-and-forget `lastRunAt` stamp for a push instance (pod-local
   * throttle, {@link PUSH_SEEN_STAMP_THROTTLE_MS}). Best-effort: a write failure
   * is logged and swallowed so it never affects the ingest path.
   */
  recordPushSeen(sourceId: string): Promise<void>;
}

export function createPushTokenVerifier({
  db,
  logger,
  now = () => new Date(),
}: {
  db: Db;
  logger: Logger;
  now?: () => Date;
}): PushTokenVerifier {
  /** Last time this pod stamped a `lastRunAt` for a source (write throttle). */
  const lastSeenStampMs = new Map<string, number>();

  return {
    async lookupPushToken({ sourceTypeId, tokenHash }) {
      if (tokenHash.length === 0) return null;
      const [row] = await db
        .select({
          id: telemetrySources.id,
          sourceTypeId: telemetrySources.sourceTypeId,
          bindings: telemetrySources.bindings,
          enabled: telemetrySources.enabled,
        })
        .from(telemetrySources)
        .where(eq(telemetrySources.pushTokenHash, tokenHash))
        .limit(1);
      if (!row) return null;
      // Type scoping: a token minted for one push type never verifies for
      // another. A hash collision across types is cryptographically negligible;
      // this guard makes the SCOPE explicit and cheap.
      if (row.sourceTypeId !== sourceTypeId) return null;
      return {
        sourceId: row.id,
        bindings: row.bindings,
        enabled: row.enabled,
        revoked: !row.enabled,
      };
    },

    async recordPushSeen(sourceId) {
      const nowMs = now().getTime();
      const lastMs = lastSeenStampMs.get(sourceId) ?? 0;
      if (nowMs - lastMs < PUSH_SEEN_STAMP_THROTTLE_MS) return;
      lastSeenStampMs.set(sourceId, nowMs);
      try {
        const at = now();
        await db
          .update(telemetrySources)
          .set({ lastRunAt: at, updatedAt: at })
          .where(eq(telemetrySources.id, sourceId));
      } catch (error) {
        logger.debug(
          `telemetry push: recordPushSeen failed for ${sourceId}: ${String(error)}`,
        );
      }
    },
  };
}

/**
 * Any non-null Date marks a token revoked to {@link IngestAuthenticator}
 * (`revokedAt !== null`); it never reads the value, so this fixed sentinel keeps
 * the adapter clock-free while still yielding a `{ ok: false, reason: "revoked" }`
 * verdict for a disabled instance or a signal the instance does not route.
 */
const REVOKED_AT_SENTINEL = new Date(0);

/**
 * PUBLIC SURFACE for endpoint-owning plugins: build an
 * {@link IngestTokenLookup} over push tokens of one source `sourceTypeId`,
 * resolving the binding for one `signal`. Feed the returned lookup to
 * `createIngestAuthenticator({ lookup, cache, hashToken })` and you get the same
 * cached, negative-cache-protected verification the built-in stream plugins use
 * for their native source tokens.
 *
 * Verdicts:
 * - Unknown hash (no instance, or a token of a DIFFERENT push type) -> null, so
 *   the authenticator answers `{ ok: false, reason: "unknown" }` and caches the
 *   miss.
 * - Instance disabled, OR enabled but WITHOUT a binding for `signal` (the token
 *   is real but does not route this endpoint's signal) -> a row with a non-null
 *   `revokedAt`, so the authenticator answers `{ ok: false, reason: "revoked" }`.
 *   Deliberately NOT null: a real token must not poison the negative cache.
 * - Enabled with a binding for `signal` -> a row whose `resourceId` is the bound
 *   stream id, so the authenticator answers `{ ok: true, resourceId }`.
 *
 * The returned `tokenHash` echoes the queried hash (the lookup already filtered
 * the DB row by it), satisfying the authenticator's defense-in-depth
 * constant-time hash confirm.
 */
export function createPushTokenLookup({
  verifier,
  sourceTypeId,
  signal,
}: {
  verifier: PushTokenVerifier;
  sourceTypeId: string;
  signal: TelemetrySignal;
}): IngestTokenLookup {
  return async (tokenHash) => {
    const result = await verifier.lookupPushToken({ sourceTypeId, tokenHash });
    if (!result) return null;
    const binding = result.bindings.find((b) => b.signal === signal);
    const revoked = result.revoked || !binding;
    const row: IngestTokenRow = {
      tokenId: result.sourceId,
      // Unused when revoked (the authenticator returns before reading it); the
      // bound stream id otherwise.
      resourceId: binding?.streamId ?? "",
      tokenHash,
      revokedAt: revoked ? REVOKED_AT_SENTINEL : null,
    };
    return row;
  };
}
