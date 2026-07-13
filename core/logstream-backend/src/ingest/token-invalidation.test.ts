import { describe, it, expect } from "bun:test";
import type { IngestAuthenticator } from "./auth";
import type { SyslogListener } from "./syslog/listener";
import { applyTokenInvalidation } from "./setup";

/**
 * Dispatch tests for the `logstream.tokens.invalidated` broadcast consumer:
 * revoke/delete evict positive syslog connection verdicts; mint clears the
 * per-pod negative token cache and negative connection verdicts.
 */

function recordingListener(): {
  listener: SyslogListener;
  calls: Array<{ tokenIds?: readonly string[]; negatives?: boolean }>;
} {
  const calls: Array<{ tokenIds?: readonly string[]; negatives?: boolean }> = [];
  return {
    calls,
    listener: {
      start: () => {},
      stop: () => {},
      invalidateVerdicts: (args) => {
        calls.push(args);
        return 0;
      },
    },
  };
}

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

describe("applyTokenInvalidation", () => {
  it("revoked: evicts positive verdicts for the token ids", async () => {
    const { listener, calls } = recordingListener();
    const { auth, cleared } = recordingAuth();

    await applyTokenInvalidation({
      payload: {
        streamId: "s1",
        reason: "revoked",
        tokenIds: ["tok-1"],
        tokenHashes: ["h1"],
      },
      auth,
      listener,
    });

    expect(calls).toEqual([{ tokenIds: ["tok-1"] }]);
    expect(cleared).toEqual([]); // negative cache untouched on revoke
  });

  it("stream_deleted: evicts positive verdicts for every deleted token", async () => {
    const { listener, calls } = recordingListener();
    const { auth } = recordingAuth();

    await applyTokenInvalidation({
      payload: {
        streamId: "s1",
        reason: "stream_deleted",
        tokenIds: ["tok-1", "tok-2"],
        tokenHashes: ["h1", "h2"],
      },
      auth,
      listener,
    });

    expect(calls).toEqual([{ tokenIds: ["tok-1", "tok-2"] }]);
  });

  it("minted: clears the negative cache per hash and negative connection verdicts", async () => {
    const { listener, calls } = recordingListener();
    const { auth, cleared } = recordingAuth();

    await applyTokenInvalidation({
      payload: {
        streamId: "s1",
        reason: "minted",
        tokenIds: ["tok-new"],
        tokenHashes: ["hash-new"],
      },
      auth,
      listener,
    });

    expect(cleared).toEqual(["hash-new"]);
    expect(calls).toEqual([{ negatives: true }]);
  });

  it("works without a syslog listener (HTTP-only pods)", async () => {
    const { auth, cleared } = recordingAuth();

    await applyTokenInvalidation({
      payload: {
        streamId: "s1",
        reason: "minted",
        tokenIds: ["tok-new"],
        tokenHashes: ["hash-new"],
      },
      auth,
      listener: null,
    });

    expect(cleared).toEqual(["hash-new"]);
  });
});
