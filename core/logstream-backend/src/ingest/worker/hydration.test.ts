import { describe, it, expect, mock } from "bun:test";
import { createDrainEngine } from "../../drain/engine";

/**
 * The additive `loadPatternRows` seam on createDrainEngine (Phase D): a
 * worker-hosted engine hydrates from main-supplied rows instead of a DB query.
 * These tests exercise that injected path directly - no storage, no DB.
 */
describe("createDrainEngine with injected loadPatternRows", () => {
  it("seeds a stream's tree from the injected rows (no DB / storage)", async () => {
    const loadPatternRows = mock(async () => [
      { id: "p-mined", template: "cache hit key <*>", origin: "mined" },
    ]);
    const engine = createDrainEngine({ loadPatternRows });

    await engine.hydrateStream({ streamId: "s1" });
    expect(loadPatternRows).toHaveBeenCalledWith({ streamId: "s1" });

    // A line matching the seeded template classifies into it, NOT as a new cluster.
    const result = engine.classify({
      streamId: "s1",
      body: "cache hit key 4271",
      severityNumber: 9,
      at: new Date(0),
    });
    expect(result.isNew).toBe(false);
    expect(result.template).toBe("cache hit key <*>");
  });

  it("re-seeds a user row as a protected, match-first cluster", async () => {
    const loadPatternRows = mock(async () => [
      { id: "p-user", template: "user <*> logged in", origin: "user" },
    ]);
    const engine = createDrainEngine({ loadPatternRows });
    await engine.hydrateStream({ streamId: "s1" });

    const result = engine.classify({
      streamId: "s1",
      body: "user 5501 logged in",
      severityNumber: 9,
      at: new Date(0),
    });
    // The user pattern id is a pure function of (streamId, template); matching it
    // yields that id and never reports a new cluster.
    expect(result.isNew).toBe(false);
    expect(result.template).toBe("user <*> logged in");
  });

  it("hydrates a stream at most once (idempotent)", async () => {
    const loadPatternRows = mock(async () => []);
    const engine = createDrainEngine({ loadPatternRows });
    await engine.hydrateStream({ streamId: "s1" });
    await engine.hydrateStream({ streamId: "s1" });
    expect(loadPatternRows).toHaveBeenCalledTimes(1);
  });

  it("throws if constructed without storage or loadPatternRows when hydrating", async () => {
    const engine = createDrainEngine({});
    await expect(engine.hydrateStream({ streamId: "s1" })).rejects.toThrow(
      /storage.*or.*loadPatternRows/,
    );
  });
});
