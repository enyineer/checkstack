import { describe, expect, test } from "bun:test";
import { getAdjacentRun } from "./runHistorySelection.logic";

const runIds = ["newest", "middle", "oldest"];

describe("getAdjacentRun", () => {
  test("next walks down to the older run, prev walks up to the newer one", () => {
    expect(
      getAdjacentRun({
        runIds,
        currentRunId: "middle",
        direction: "next",
        page: 1,
        totalPages: 1,
      }),
    ).toEqual({ kind: "run", runId: "oldest" });
    expect(
      getAdjacentRun({
        runIds,
        currentRunId: "middle",
        direction: "prev",
        page: 1,
        totalPages: 1,
      }),
    ).toEqual({ kind: "run", runId: "newest" });
  });

  test("falls through to the next page's first run at the bottom", () => {
    expect(
      getAdjacentRun({
        runIds,
        currentRunId: "oldest",
        direction: "next",
        page: 1,
        totalPages: 3,
      }),
    ).toEqual({ kind: "page", page: 2, select: "first" });
  });

  test("falls through to the previous page's last run at the top", () => {
    expect(
      getAdjacentRun({
        runIds,
        currentRunId: "newest",
        direction: "prev",
        page: 2,
        totalPages: 3,
      }),
    ).toEqual({ kind: "page", page: 1, select: "last" });
  });

  test("absolute boundaries yield none", () => {
    expect(
      getAdjacentRun({
        runIds,
        currentRunId: "newest",
        direction: "prev",
        page: 1,
        totalPages: 3,
      }),
    ).toEqual({ kind: "none" });
    expect(
      getAdjacentRun({
        runIds,
        currentRunId: "oldest",
        direction: "next",
        page: 3,
        totalPages: 3,
      }),
    ).toEqual({ kind: "none" });
  });

  test("a run missing from the page yields none", () => {
    expect(
      getAdjacentRun({
        runIds,
        currentRunId: "aged-out",
        direction: "next",
        page: 1,
        totalPages: 1,
      }),
    ).toEqual({ kind: "none" });
  });

  test("single-run page navigates only across pages", () => {
    expect(
      getAdjacentRun({
        runIds: ["only"],
        currentRunId: "only",
        direction: "next",
        page: 1,
        totalPages: 2,
      }),
    ).toEqual({ kind: "page", page: 2, select: "first" });
    expect(
      getAdjacentRun({
        runIds: ["only"],
        currentRunId: "only",
        direction: "prev",
        page: 1,
        totalPages: 2,
      }),
    ).toEqual({ kind: "none" });
  });
});
