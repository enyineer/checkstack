import { describe, it, expect } from "bun:test";
import type { IngestAuthenticator } from "@checkstack/ingest-utils";
import { applyTokenInvalidation } from "./setup";

function fakeAuth(): IngestAuthenticator & { cleared: string[] } {
  const cleared: string[] = [];
  return {
    cleared,
    verify: async () => ({ ok: false, reason: "unknown" }),
    clearNegative: async (hash: string) => {
      cleared.push(hash);
    },
  };
}

describe("applyTokenInvalidation", () => {
  it("clears the negative cache for freshly minted token hashes", async () => {
    const auth = fakeAuth();
    await applyTokenInvalidation({
      payload: {
        streamId: "s1",
        reason: "minted",
        tokenIds: ["t1"],
        tokenHashes: ["hashA", "hashB"],
      },
      auth,
    });
    expect(auth.cleared).toEqual(["hashA", "hashB"]);
  });

  it("does nothing for revoked / stream_deleted (served by the shared-cache delete)", async () => {
    const auth = fakeAuth();
    await applyTokenInvalidation({
      payload: {
        streamId: "s1",
        reason: "revoked",
        tokenIds: ["t1"],
        tokenHashes: ["hashA"],
      },
      auth,
    });
    expect(auth.cleared).toEqual([]);
  });
});
