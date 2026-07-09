import { describe, it, expect } from "bun:test";
import {
  selectorIncludesEnvironment,
  isEnvSliceEffective,
  selectEffectiveEnvKeys,
} from "./environment-slices";

describe("selectorIncludesEnvironment", () => {
  it("null (all) includes every concrete environment", () => {
    expect(
      selectorIncludesEnvironment({ environmentIds: null, environmentId: "e" }),
    ).toBe(true);
  });

  it("undefined (all) includes every concrete environment", () => {
    expect(
      selectorIncludesEnvironment({
        environmentIds: undefined,
        environmentId: "e",
      }),
    ).toBe(true);
  });

  it("[] (opt-out) includes no concrete environment", () => {
    expect(
      selectorIncludesEnvironment({ environmentIds: [], environmentId: "e" }),
    ).toBe(false);
  });

  it("explicit list includes only its members", () => {
    expect(
      selectorIncludesEnvironment({
        environmentIds: ["a", "b"],
        environmentId: "a",
      }),
    ).toBe(true);
    expect(
      selectorIncludesEnvironment({
        environmentIds: ["a", "b"],
        environmentId: "c",
      }),
    ).toBe(false);
  });
});

describe("isEnvSliceEffective", () => {
  it("drops a concrete env that was removed from the selector (the reported bug)", () => {
    // prod disabled for the assignment -> environmentIds now only ['staging'].
    expect(
      isEnvSliceEffective({
        environmentId: "prod",
        environmentIds: ["staging"],
        hasLiveSelectedEnvSlice: true,
      }),
    ).toBe(false);
    // staging is still effective.
    expect(
      isEnvSliceEffective({
        environmentId: "staging",
        environmentIds: ["staging"],
        hasLiveSelectedEnvSlice: true,
      }),
    ).toBe(true);
  });

  it("keeps a concrete env under the all (null) selector", () => {
    expect(
      isEnvSliceEffective({
        environmentId: "prod",
        environmentIds: null,
        hasLiveSelectedEnvSlice: true,
      }),
    ).toBe(true);
  });

  it("drops every concrete env under opt-out ([])", () => {
    expect(
      isEnvSliceEffective({
        environmentId: "prod",
        environmentIds: [],
        hasLiveSelectedEnvSlice: false,
      }),
    ).toBe(false);
  });

  it("env-less slice is orphaned once the check fans out to a selected env", () => {
    expect(
      isEnvSliceEffective({
        environmentId: null,
        environmentIds: ["prod"],
        hasLiveSelectedEnvSlice: true,
      }),
    ).toBe(false);
  });

  it("env-less slice is live when the check does not currently fan out", () => {
    // opt-out: env-less is the only live slice.
    expect(
      isEnvSliceEffective({
        environmentId: null,
        environmentIds: [],
        hasLiveSelectedEnvSlice: false,
      }),
    ).toBe(true);
  });
});

describe("selectEffectiveEnvKeys", () => {
  it("keeps only the selected env when the other was disabled", () => {
    // Runs still exist for prod (disabled) + staging (kept). prod must drop.
    const effective = selectEffectiveEnvKeys({
      environmentIds: ["staging"],
      presentEnvKeys: ["prod", "staging"],
    });
    expect([...effective].sort()).toEqual(["staging"]);
  });

  it("drops the stale env-less slice when the check now fans out", () => {
    const effective = selectEffectiveEnvKeys({
      environmentIds: null,
      presentEnvKeys: [null, "prod"],
    });
    expect([...effective]).toEqual(["prod"]);
  });

  it("keeps only the env-less slice on opt-out even with historical concrete runs", () => {
    const effective = selectEffectiveEnvKeys({
      environmentIds: [],
      presentEnvKeys: [null, "prod", "staging"],
    });
    expect([...effective]).toEqual([null]);
  });

  it("keeps all concrete envs under the all (null) selector", () => {
    const effective = selectEffectiveEnvKeys({
      environmentIds: null,
      presentEnvKeys: ["prod", "staging"],
    });
    expect([...effective].sort()).toEqual(["prod", "staging"]);
  });
});
