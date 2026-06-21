import { describe, expect, it } from "bun:test";
import { computeFleetSummary } from "./fleetSummary.logic";

describe("computeFleetSummary", () => {
  it("returns zeroes for an empty fleet", () => {
    expect(computeFleetSummary([])).toEqual({
      total: 0,
      online: 0,
      offline: 0,
    });
  });

  it("counts online satellites", () => {
    expect(
      computeFleetSummary([{ status: "online" }, { status: "online" }]),
    ).toEqual({ total: 2, online: 2, offline: 0 });
  });

  it("counts offline as the complement of online", () => {
    expect(
      computeFleetSummary([
        { status: "online" },
        { status: "offline" },
        { status: "offline" },
      ]),
    ).toEqual({ total: 3, online: 1, offline: 2 });
  });

  it("treats an all-offline fleet correctly", () => {
    expect(
      computeFleetSummary([{ status: "offline" }, { status: "offline" }]),
    ).toEqual({ total: 2, online: 0, offline: 2 });
  });
});
