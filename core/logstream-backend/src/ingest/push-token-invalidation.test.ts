import { describe, it, expect } from "bun:test";
import type { CachedScope } from "@checkstack/cache-utils";
import type { TelemetryPushTokenInvalidatedPayload } from "@checkstack/telemetry-backend";
import type { IngestAuthenticator } from "./auth";
import { ingestTokenCacheKey } from "../api/token-cache";
import { ingestTokenMissKey } from "./auth";
import { applyPushTokenInvalidation } from "./setup";

/**
 * Dispatch tests for the `telemetry.push-token.invalidated` consumer. The
 * PLATFORM owns push-instance lifecycle now, so this consumer converges BOTH the
 * shared cache (there is no other logstream writer) and the pod-local negative
 * cache:
 * - `revoked` deletes the shared positive verdict key + the miss marker;
 * - `minted` clears the pod-local negative cache AND deletes the miss marker.
 */

function recordingAuth(): { auth: IngestAuthenticator; cleared: string[] } {
  const cleared: string[] = [];
  return {
    cleared,
    auth: {
      verify: async () => ({ ok: false, reason: "unknown" }),
      clearNegative: async (hash) => {
        cleared.push(hash);
      },
    },
  };
}

function recordingCache(): { cache: CachedScope; invalidated: string[] } {
  const invalidated: string[] = [];
  const cache = {
    invalidate: async (key: string) => {
      invalidated.push(key);
    },
  } as unknown as CachedScope;
  return { cache, invalidated };
}

function payload(
  reason: "minted" | "revoked",
  tokenHash: string,
): TelemetryPushTokenInvalidatedPayload {
  return { sourceTypeId: "logstream.push", sourceId: "src-1", tokenHash, reason };
}

describe("applyPushTokenInvalidation", () => {
  it("revoked: deletes the shared positive verdict AND the miss marker", async () => {
    const { auth, cleared } = recordingAuth();
    const { cache, invalidated } = recordingCache();

    await applyPushTokenInvalidation({
      payload: payload("revoked", "hash-rev"),
      auth,
      cache,
    });

    expect(invalidated).toEqual([
      ingestTokenCacheKey("hash-rev"),
      ingestTokenMissKey("hash-rev"),
    ]);
    // Revoke touches only the shared cache; no pod-local negative work.
    expect(cleared).toEqual([]);
  });

  it("minted: clears the pod-local negative cache AND the shared miss marker", async () => {
    const { auth, cleared } = recordingAuth();
    const { cache, invalidated } = recordingCache();

    await applyPushTokenInvalidation({
      payload: payload("minted", "hash-new"),
      auth,
      cache,
    });

    expect(cleared).toEqual(["hash-new"]);
    expect(invalidated).toEqual([ingestTokenMissKey("hash-new")]);
    // Minted must NOT delete the positive key (there is no stale ok verdict).
    expect(invalidated).not.toContain(ingestTokenCacheKey("hash-new"));
  });
});
