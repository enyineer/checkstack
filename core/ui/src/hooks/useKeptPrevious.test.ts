import { describe, expect, it } from "bun:test";
import { selectKeptPrevious } from "./useKeptPrevious";

describe("selectKeptPrevious", () => {
  it("returns current data (not stale) when not fetching", () => {
    expect(
      selectKeptPrevious({ data: [1, 2], previous: [9], isFetching: false }),
    ).toEqual({ data: [1, 2], isStale: false });
  });

  it("keeps previous non-empty data and marks stale when refetch yields empty", () => {
    expect(
      selectKeptPrevious({ data: [], previous: [1, 2], isFetching: true }),
    ).toEqual({ data: [1, 2], isStale: true });
  });

  it("shows incoming data while fetching but marks it stale (background refresh)", () => {
    // Data is already present and a refetch is in flight: show the latest rows
    // but dim them so the refresh is visible without a layout jump.
    expect(
      selectKeptPrevious({ data: [3, 4], previous: [1, 2], isFetching: true }),
    ).toEqual({ data: [3, 4], isStale: true });
  });

  it("does not keep previous when there is no previous data (first load)", () => {
    expect(
      selectKeptPrevious({ data: [], previous: [], isFetching: true }),
    ).toEqual({ data: [], isStale: false });
  });

  it("is not stale on the very first fetch with no prior rows", () => {
    expect(
      selectKeptPrevious({ data: [], previous: [], isFetching: true }).isStale,
    ).toBe(false);
  });
});
