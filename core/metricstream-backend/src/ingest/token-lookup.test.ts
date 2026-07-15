import { describe, it, expect } from "bun:test";
import type {
  PushTokenLookupResult,
  PushTokenVerifier,
} from "@checkstack/telemetry-backend";
import type { SourceBinding } from "@checkstack/telemetry-common";
import { createMetricstreamPushTokenLookup } from "./token-lookup";

/**
 * A verifier that answers a fixed verdict and records the scoping it was asked
 * for, so we can assert the lookup queries the `metricstream.push` type and maps
 * the platform verdict onto the ingest-authenticator's row shape.
 */
function fakeVerifier(
  result: PushTokenLookupResult | null,
): PushTokenVerifier & { asked: { sourceTypeId: string; tokenHash: string }[] } {
  const asked: { sourceTypeId: string; tokenHash: string }[] = [];
  return {
    asked,
    lookupPushToken: async ({ sourceTypeId, tokenHash }) => {
      asked.push({ sourceTypeId, tokenHash });
      return result;
    },
    recordPushSeen: async () => {},
  };
}

const metricsBinding: SourceBinding = { signal: "metrics", streamId: "stream-1" };

describe("createMetricstreamPushTokenLookup", () => {
  it("scopes the query to metricstream.push and resolves an enabled metrics-bound token to its stream", async () => {
    const verifier = fakeVerifier({
      sourceId: "src-1",
      bindings: [metricsBinding],
      enabled: true,
      revoked: false,
    });
    const lookup = createMetricstreamPushTokenLookup({ verifier });

    const row = await lookup("hashA");

    expect(verifier.asked).toEqual([
      { sourceTypeId: "metricstream.push", tokenHash: "hashA" },
    ]);
    expect(row).not.toBeNull();
    expect(row!.resourceId).toBe("stream-1");
    expect(row!.tokenId).toBe("src-1");
    expect(row!.revokedAt).toBeNull();
  });

  it("returns null for an unknown hash (authenticator caches the miss)", async () => {
    const lookup = createMetricstreamPushTokenLookup({ verifier: fakeVerifier(null) });
    expect(await lookup("nope")).toBeNull();
  });

  it("marks a disabled instance revoked (non-null revokedAt, never null)", async () => {
    const verifier = fakeVerifier({
      sourceId: "src-1",
      bindings: [metricsBinding],
      enabled: false,
      revoked: true,
    });
    const row = await createMetricstreamPushTokenLookup({ verifier })("hashA");
    expect(row).not.toBeNull();
    expect(row!.revokedAt).not.toBeNull();
  });

  it("marks an enabled instance WITHOUT a metrics binding revoked (real token must not poison the negative cache)", async () => {
    const verifier = fakeVerifier({
      sourceId: "src-1",
      bindings: [{ signal: "logs", streamId: "other" }],
      enabled: true,
      revoked: false,
    });
    const row = await createMetricstreamPushTokenLookup({ verifier })("hashA");
    expect(row).not.toBeNull();
    expect(row!.revokedAt).not.toBeNull();
  });
});
