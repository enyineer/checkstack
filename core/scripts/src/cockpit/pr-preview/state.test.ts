import { afterAll, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  parsePreviewState,
  readPreviewState,
  stateFilePath,
  writePreviewState,
} from "./state.ts";

describe("parsePreviewState", () => {
  it("parses valid state", () => {
    const state = parsePreviewState(
      JSON.stringify({ snapshotAt: "2026-07-01T00:00:00Z", mergedPrs: [380] }),
    );
    expect(state.mergedPrs).toEqual([380]);
  });

  it("falls back to empty on malformed input", () => {
    expect(parsePreviewState("{not json")).toEqual({});
    expect(parsePreviewState(JSON.stringify({ mergedPrs: "nope" }))).toEqual({});
  });
});

describe("read/write round-trip", () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pr-preview-state-"));

  afterAll(() => {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  it("returns empty when no file exists", () => {
    expect(readPreviewState({ repoRoot })).toEqual({});
  });

  it("writes then reads back the state, creating .dev/pr-preview", () => {
    writePreviewState({
      repoRoot,
      state: { snapshotAt: "2026-07-01T12:00:00Z", mergedPrs: [380, 381] },
    });
    expect(fs.existsSync(stateFilePath(repoRoot))).toBe(true);
    const state = readPreviewState({ repoRoot });
    expect(state.snapshotAt).toBe("2026-07-01T12:00:00Z");
    expect(state.mergedPrs).toEqual([380, 381]);
  });
});
