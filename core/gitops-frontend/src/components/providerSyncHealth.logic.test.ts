import { describe, expect, it } from "bun:test";
import { classifySyncHealth } from "./providerSyncHealth.logic";

describe("classifySyncHealth", () => {
  it("reports a sync error as the down tone, even when a last-sync time exists", () => {
    expect(
      classifySyncHealth({
        lastSyncAt: new Date("2026-01-01T00:00:00Z"),
        lastSyncError: "boom",
      }),
    ).toEqual({ tone: "down", label: "Sync error" });
  });

  it("reports an error as down tone when there is no last-sync time", () => {
    expect(
      classifySyncHealth({ lastSyncAt: null, lastSyncError: "boom" }),
    ).toEqual({ tone: "down", label: "Sync error" });
  });

  it("reports a clean successful sync as the ok tone", () => {
    expect(
      classifySyncHealth({
        lastSyncAt: new Date("2026-01-01T00:00:00Z"),
        lastSyncError: null,
      }),
    ).toEqual({ tone: "ok", label: "Synced" });
  });

  it("reports a never-synced provider as the unknown tone", () => {
    expect(
      classifySyncHealth({ lastSyncAt: null, lastSyncError: null }),
    ).toEqual({ tone: "unknown", label: "Never synced" });
  });
});
