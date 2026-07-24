import { describe, expect, test } from "bun:test";
import {
  isSourceSliceEffective,
  runsLocally,
  selectEffectiveRunSlices,
  selectorForSource,
  type RunSliceKey,
} from "./run-slices";

/** Sort so assertions don't depend on Map iteration order. */
const sorted = (slices: RunSliceKey[]): RunSliceKey[] =>
  [...slices].sort((a, b) =>
    `${a.sourceId}${a.environmentId}`.localeCompare(
      `${b.sourceId}${b.environmentId}`,
    ),
  );

describe("runsLocally", () => {
  test("an assignment with no satellites always runs locally", () => {
    // `includeLocal: false` with no satellites would otherwise leave the
    // assignment with NO effective source, silently discarding every run.
    expect(runsLocally({ includeLocal: false, satelliteIds: null })).toBe(true);
    expect(runsLocally({ includeLocal: false, satelliteIds: [] })).toBe(true);
  });

  test("with satellites assigned, the flag decides", () => {
    expect(runsLocally({ includeLocal: true, satelliteIds: ["sat-1"] })).toBe(
      true,
    );
    expect(runsLocally({ includeLocal: false, satelliteIds: ["sat-1"] })).toBe(
      false,
    );
  });
});

describe("isSourceSliceEffective", () => {
  const satelliteIds = ["sat-1"];

  test("an assigned satellite contributes; an unassigned one does not", () => {
    expect(
      isSourceSliceEffective({ sourceId: "sat-1", includeLocal: true, satelliteIds }),
    ).toBe(true);
    // De-assigning a satellite must drop its slice immediately: no
    // health-change event fires for a slice that simply stopped producing runs.
    expect(
      isSourceSliceEffective({ sourceId: "sat-gone", includeLocal: true, satelliteIds }),
    ).toBe(false);
  });

  test("the local slice follows includeLocal", () => {
    expect(
      isSourceSliceEffective({ sourceId: null, includeLocal: false, satelliteIds }),
    ).toBe(false);
    expect(
      isSourceSliceEffective({ sourceId: null, includeLocal: true, satelliteIds }),
    ).toBe(true);
  });
});

describe("selectorForSource", () => {
  test("local always uses the assignment's own selector", () => {
    expect(
      selectorForSource({
        sourceId: null,
        environmentIds: ["prod"],
        satelliteEnvironmentIds: { "sat-1": ["dev"] },
      }),
    ).toEqual(["prod"]);
  });

  test("an unscoped satellite inherits the assignment's selector", () => {
    for (const satelliteEnvironmentIds of [undefined, null, { "sat-1": null }]) {
      expect(
        selectorForSource({
          sourceId: "sat-1",
          environmentIds: ["prod", "dev"],
          satelliteEnvironmentIds,
        }),
      ).toEqual(["prod", "dev"]);
    }
  });

  test("a satellite narrows but can never widen", () => {
    expect(
      selectorForSource({
        sourceId: "sat-1",
        environmentIds: ["prod"],
        satelliteEnvironmentIds: { "sat-1": ["prod", "dev"] },
      }),
    ).toEqual(["prod"]);
  });

  test("a satellite's list applies as-is when the assignment restricts nothing", () => {
    expect(
      selectorForSource({
        sourceId: "sat-1",
        environmentIds: null,
        satelliteEnvironmentIds: { "sat-1": ["prod"] },
      }),
    ).toEqual(["prod"]);
  });

  test("either side opting out opts the pair out", () => {
    expect(
      selectorForSource({
        sourceId: "sat-1",
        environmentIds: ["prod"],
        satelliteEnvironmentIds: { "sat-1": [] },
      }),
    ).toEqual([]);
    expect(
      selectorForSource({
        sourceId: "sat-1",
        environmentIds: [],
        satelliteEnvironmentIds: { "sat-1": ["prod"] },
      }),
    ).toEqual([]);
  });
});

describe("selectEffectiveRunSlices", () => {
  const base = {
    environmentIds: null,
    includeLocal: true,
    satelliteIds: ["sat-1"],
    satelliteEnvironmentIds: null,
  };

  test("the reported bug: local and satellite are SEPARATE slices", () => {
    // The whole point. One env, two sources => two independently-evaluated
    // streams, so a permanently-failing satellite can never be masked by a
    // healthy local check interleaving with it.
    expect(
      sorted(
        selectEffectiveRunSlices({
          ...base,
          presentSlices: [
            { environmentId: null, sourceId: null },
            { environmentId: null, sourceId: "sat-1" },
          ],
        }),
      ),
    ).toEqual([
      { environmentId: null, sourceId: null },
      { environmentId: null, sourceId: "sat-1" },
    ]);
  });

  test("environment and source fan-out multiply", () => {
    expect(
      sorted(
        selectEffectiveRunSlices({
          ...base,
          environmentIds: ["prod", "dev"],
          presentSlices: [
            { environmentId: "prod", sourceId: null },
            { environmentId: "dev", sourceId: null },
            { environmentId: "prod", sourceId: "sat-1" },
            { environmentId: "dev", sourceId: "sat-1" },
          ],
        }),
      ).length,
    ).toBe(4);
  });

  test("a de-assigned satellite's stale slices drop out", () => {
    expect(
      selectEffectiveRunSlices({
        ...base,
        presentSlices: [
          { environmentId: null, sourceId: null },
          { environmentId: null, sourceId: "sat-removed" },
        ],
      }),
    ).toEqual([{ environmentId: null, sourceId: null }]);
  });

  test("a disabled environment drops out per source", () => {
    expect(
      sorted(
        selectEffectiveRunSlices({
          ...base,
          environmentIds: ["prod"],
          presentSlices: [
            { environmentId: "prod", sourceId: null },
            { environmentId: "dev", sourceId: null },
            { environmentId: "prod", sourceId: "sat-1" },
            { environmentId: "dev", sourceId: "sat-1" },
          ],
        }),
      ),
    ).toEqual([
      { environmentId: "prod", sourceId: null },
      { environmentId: "prod", sourceId: "sat-1" },
    ]);
  });

  test("per-satellite scoping keeps only that satellite's environments", () => {
    // A prod satellite that has (historically) probed dev too keeps only prod.
    expect(
      sorted(
        selectEffectiveRunSlices({
          ...base,
          environmentIds: ["prod", "dev"],
          satelliteEnvironmentIds: { "sat-1": ["prod"] },
          presentSlices: [
            { environmentId: "prod", sourceId: null },
            { environmentId: "dev", sourceId: null },
            { environmentId: "prod", sourceId: "sat-1" },
            { environmentId: "dev", sourceId: "sat-1" },
          ],
        }),
      ),
    ).toEqual([
      { environmentId: "dev", sourceId: null },
      { environmentId: "prod", sourceId: null },
      { environmentId: "prod", sourceId: "sat-1" },
    ]);
  });

  test("env-less orphaning is resolved PER SOURCE", () => {
    // The local source fans out to prod, so its own env-less slice is stale.
    // The satellite is scoped to `[]` (runs once, env-less), so ITS env-less
    // slice is live. One global `hasLiveSelectedEnvSlice` would orphan both.
    expect(
      sorted(
        selectEffectiveRunSlices({
          ...base,
          environmentIds: ["prod"],
          satelliteEnvironmentIds: { "sat-1": [] },
          presentSlices: [
            { environmentId: "prod", sourceId: null },
            { environmentId: null, sourceId: null },
            { environmentId: null, sourceId: "sat-1" },
          ],
        }),
      ),
    ).toEqual([
      { environmentId: "prod", sourceId: null },
      { environmentId: null, sourceId: "sat-1" },
    ]);
  });

  test("an environment-scoped view still splits by source", () => {
    // Pinning an environment must not re-collapse the sources - that is the
    // masking bug again, just inside one environment's view.
    expect(
      sorted(
        selectEffectiveRunSlices({
          ...base,
          environmentIds: ["prod", "dev"],
          environmentScope: "prod",
          presentSlices: [
            { environmentId: "prod", sourceId: null },
            { environmentId: "prod", sourceId: "sat-1" },
            { environmentId: "dev", sourceId: null },
          ],
        }),
      ),
    ).toEqual([
      { environmentId: "prod", sourceId: null },
      { environmentId: "prod", sourceId: "sat-1" },
    ]);
  });

  test("a scoped view keeps the user's environment even when the selector dropped it", () => {
    // The pinned environment is an explicit choice; only sources are filtered.
    expect(
      selectEffectiveRunSlices({
        ...base,
        environmentIds: ["prod"],
        environmentScope: "dev",
        presentSlices: [{ environmentId: "dev", sourceId: null }],
      }),
    ).toEqual([{ environmentId: "dev", sourceId: null }]);
  });

  test("no runs at all yields no slices", () => {
    expect(selectEffectiveRunSlices({ ...base, presentSlices: [] })).toEqual([]);
  });
});
