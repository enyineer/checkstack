/**
 * Test-support stub for the platform {@link PushTokenVerifier}. Lets logstream's
 * ingest tests exercise the REAL verify wiring (`createPushTokenLookup` +
 * `createIngestAuthenticator` + the endpoints/satellite handler) without the
 * telemetry platform's database - it plays the role telemetry migration 0002's
 * promoted `telemetry_sources` rows play in production: a hash resolves to a
 * push source bound to a stream, mirroring a promoted `log_stream_tokens` row.
 *
 * Not wired into any production path; imported only by tests.
 */

import type { PushTokenVerifier } from "@checkstack/telemetry-backend";
import type { SourceBinding } from "@checkstack/telemetry-common";

export interface StubPushSource {
  /** The push source instance id (`tokenId` in the resolved verdict). */
  sourceId: string;
  /** The stream this source's `logs` binding routes to. */
  streamId: string;
  /** sha256 hex of the source's bearer token. */
  tokenHash: string;
  /** Disabled instances resolve as `revoked` (matches the platform). */
  enabled?: boolean;
}

export interface StubPushVerifier extends PushTokenVerifier {
  /** Ids passed to {@link PushTokenVerifier.recordPushSeen}, in call order. */
  seen: string[];
}

/**
 * Build a stub verifier over a fixed set of promoted-style push sources. It
 * type-scopes exactly like the real verifier: a lookup for a foreign
 * `sourceTypeId` resolves to null.
 */
export function createStubPushVerifier({
  sources,
  sourceTypeId = "logstream.push",
}: {
  sources: StubPushSource[];
  sourceTypeId?: string;
}): StubPushVerifier {
  const byHash = new Map(sources.map((s) => [s.tokenHash, s]));
  const seen: string[] = [];
  return {
    seen,
    lookupPushToken: async ({ sourceTypeId: queriedType, tokenHash }) => {
      if (queriedType !== sourceTypeId) return null;
      const source = byHash.get(tokenHash);
      if (!source) return null;
      const enabled = source.enabled ?? true;
      const bindings: SourceBinding[] = [
        { signal: "logs", streamId: source.streamId },
      ];
      return { sourceId: source.sourceId, bindings, enabled, revoked: !enabled };
    },
    recordPushSeen: async (sourceId) => {
      seen.push(sourceId);
    },
  };
}
