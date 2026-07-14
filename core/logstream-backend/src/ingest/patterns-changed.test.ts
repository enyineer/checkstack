import { describe, it, expect } from "bun:test";
import { createMockLogger } from "@checkstack/test-utils-backend";
import { createDrainEngine } from "../drain/engine";
import type { FlushExecutor } from "./flush-executor";
import { createInProcessFlushExecutor } from "./flush-executor";
import { applyPatternsChanged } from "./setup";

/**
 * Dispatch tests for the `logstream.patterns.changed` broadcast consumer: an
 * `upserted` event installs the user cluster on this pod's Drain tree (via the
 * flush executor, so it reaches wherever the tree lives), a `removed` event
 * drops it. Mirrors token-invalidation.test.ts.
 */

function recordingExecutor(): {
  executor: Pick<
    FlushExecutor,
    "upsertUserPattern" | "removeUserPattern" | "setPatternHidden"
  >;
  upserts: Array<{ streamId: string; template: string }>;
  removals: Array<{ streamId: string; patternId: string }>;
  hiddenToggles: Array<{ streamId: string; patternId: string; hidden: boolean }>;
} {
  const upserts: Array<{ streamId: string; template: string }> = [];
  const removals: Array<{ streamId: string; patternId: string }> = [];
  const hiddenToggles: Array<{
    streamId: string;
    patternId: string;
    hidden: boolean;
  }> = [];
  const executor: Pick<
    FlushExecutor,
    "upsertUserPattern" | "removeUserPattern" | "setPatternHidden"
  > = {
    upsertUserPattern: (input) => {
      upserts.push(input);
    },
    removeUserPattern: (input) => {
      removals.push(input);
    },
    setPatternHidden: (input) => {
      hiddenToggles.push(input);
    },
  };
  return { executor, upserts, removals, hiddenToggles };
}

describe("applyPatternsChanged", () => {
  it("upserted: installs the user cluster via upsertUserPattern", () => {
    const { executor, upserts, removals } = recordingExecutor();
    applyPatternsChanged({
      payload: {
        streamId: "s1",
        patternId: "p:abc",
        template: "user <*> logged in",
        action: "upserted",
      },
      executor,
    });
    expect(upserts).toEqual([{ streamId: "s1", template: "user <*> logged in" }]);
    expect(removals).toEqual([]);
  });

  it("removed: drops the user cluster via removeUserPattern", () => {
    const { executor, upserts, removals } = recordingExecutor();
    applyPatternsChanged({
      payload: {
        streamId: "s1",
        patternId: "p:abc",
        template: "user <*> logged in",
        action: "removed",
      },
      executor,
    });
    expect(removals).toEqual([{ streamId: "s1", patternId: "p:abc" }]);
    expect(upserts).toEqual([]);
  });

  it("hidden-changed: flips the pattern's hidden flag via setPatternHidden", () => {
    const { executor, upserts, removals, hiddenToggles } = recordingExecutor();
    applyPatternsChanged({
      payload: {
        streamId: "s1",
        patternId: "p:abc",
        template: "user <*> logged in",
        action: "hidden-changed",
        hidden: true,
      },
      executor,
    });
    expect(hiddenToggles).toEqual([
      { streamId: "s1", patternId: "p:abc", hidden: true },
    ]);
    expect(upserts).toEqual([]);
    expect(removals).toEqual([]);
  });
});

/**
 * End-to-end effect of the consumer on CLASSIFICATION: an `upserted` event makes
 * a matching line resolve to the user pattern (protected, match-first, ahead of
 * mining); a `removed` event drops that protection so the next matching line
 * re-mines. Uses a real in-process executor over a real Drain engine.
 */
describe("applyPatternsChanged effect on classification", () => {
  const streamId = "s1";
  const template = "user <*> logged in";

  function realExecutor() {
    const drain = createDrainEngine({ loadPatternRows: async () => [] });
    const executor = createInProcessFlushExecutor({
      drain,
      logger: createMockLogger(),
    });
    return { drain, executor };
  }

  function classify(drain: ReturnType<typeof realExecutor>["drain"], body: string) {
    return drain.classify({ streamId, body, severityNumber: 9, at: new Date(0) });
  }

  it("upserted: a matching line classifies to the user pattern with precedence over mining", () => {
    const { drain, executor } = realExecutor();
    // Before the user pattern exists, the shape MINES a fresh cluster. Its id is
    // sha256(streamId + template), so it equals the user pattern's id too.
    const mined = classify(drain, "user 1 logged in");
    expect(mined.isNew).toBe(true);
    const userId = mined.patternId;

    applyPatternsChanged({
      payload: { streamId, patternId: userId, template, action: "upserted" },
      executor,
    });

    // The same shape now hits the protected user cluster first: not a new
    // cluster, resolving to the user pattern id + template.
    const after = classify(drain, "user 2 logged in");
    expect(after.isNew).toBe(false);
    expect(after.patternId).toBe(userId);
    expect(after.template).toBe(template);
  });

  it("removed: classification falls back to mining once the user pattern is dropped", () => {
    const { drain, executor } = realExecutor();
    const userId = classify(drain, "user 1 logged in").patternId;
    applyPatternsChanged({
      payload: { streamId, patternId: userId, template, action: "upserted" },
      executor,
    });
    // Confirm the protection took effect first.
    expect(classify(drain, "user 2 logged in").isNew).toBe(false);

    applyPatternsChanged({
      payload: { streamId, patternId: userId, template, action: "removed" },
      executor,
    });

    // Protection dropped: the next matching line re-mines a fresh cluster
    // instead of hitting a protected one.
    expect(classify(drain, "user 3 logged in").isNew).toBe(true);
  });
});
