import { describe, expect, test } from "bun:test";
import { resolveRunEnvironmentLabel } from "./environmentLabel.logic";

const environments = [
  { id: "env-prod", name: "Production" },
  { id: "env-stage", name: "Staging" },
];

describe("resolveRunEnvironmentLabel", () => {
  test("an env-less run has no environment to show", () => {
    for (const environmentId of [null, undefined, ""]) {
      expect(
        resolveRunEnvironmentLabel({
          environmentId,
          environmentLabels: environments,
        }),
      ).toEqual({ kind: "none" });
    }
  });

  test("a live environment resolves to its name", () => {
    expect(
      resolveRunEnvironmentLabel({
        environmentId: "env-prod",
        environmentLabels: environments,
      }),
    ).toEqual({ kind: "named", name: "Production" });
  });

  test("an id absent from the FULL list reads as removed", () => {
    // Only sound because the caller passed every environment in the instance.
    expect(
      resolveRunEnvironmentLabel({
        environmentId: "env-deleted",
        environmentLabels: environments,
      }),
    ).toEqual({ kind: "removed" });
  });

  test("resolves an environment that exists but is no longer assigned", () => {
    // The reason the list is instance-wide rather than per-system: a run
    // recorded before the environment was unassigned still shows its name.
    expect(
      resolveRunEnvironmentLabel({
        environmentId: "env-stage",
        environmentLabels: environments,
      }),
    ).toEqual({ kind: "named", name: "Staging" });
  });

  test("with an EMPTY list every environment reads as removed", () => {
    // Regression (@stuajnht): the history page passed no labels at all, so the
    // table saw an empty list and labelled every live environment "Removed
    // environment". The lookup is behaving correctly here - which is why the
    // real fix is that the prop is now required, so a page cannot forget it.
    expect(
      resolveRunEnvironmentLabel({
        environmentId: "env-prod",
        environmentLabels: [],
      }),
    ).toEqual({ kind: "removed" });
  });
});
