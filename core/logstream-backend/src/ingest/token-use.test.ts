import { describe, it, expect } from "bun:test";
import { TokenUseTracker } from "./token-use";

describe("TokenUseTracker", () => {
  it("records at most one use per token per minute", () => {
    const tracker = new TokenUseTracker();
    tracker.record({ tokenId: "t1", at: new Date("2026-07-12T10:00:10Z") });
    tracker.record({ tokenId: "t1", at: new Date("2026-07-12T10:00:50Z") });
    // Same minute -> collapsed to one pending update.
    expect(tracker.drain()).toEqual([
      { tokenId: "t1", at: new Date("2026-07-12T10:00:10Z") },
    ]);
  });

  it("records again in a later minute and drains empty afterwards", () => {
    const tracker = new TokenUseTracker();
    tracker.record({ tokenId: "t1", at: new Date("2026-07-12T10:00:10Z") });
    expect(tracker.drain()).toHaveLength(1);
    expect(tracker.drain()).toEqual([]);
    tracker.record({ tokenId: "t1", at: new Date("2026-07-12T10:01:10Z") });
    expect(tracker.drain()).toHaveLength(1);
  });

  it("tracks distinct tokens independently", () => {
    const tracker = new TokenUseTracker();
    tracker.record({ tokenId: "t1", at: new Date("2026-07-12T10:00:10Z") });
    tracker.record({ tokenId: "t2", at: new Date("2026-07-12T10:00:10Z") });
    expect(tracker.drain()).toHaveLength(2);
  });
});
