import { describe, expect, it } from "bun:test";
import {
  maintenanceStatusLabel,
  maintenanceStatusTone,
} from "./maintenanceStatusTone";

describe("maintenanceStatusTone", () => {
  it("maps each maintenance status to its canonical tone (matching badges.tsx)", () => {
    expect(maintenanceStatusTone("in_progress")).toBe("warn");
    expect(maintenanceStatusTone("scheduled")).toBe("info");
    expect(maintenanceStatusTone("completed")).toBe("ok");
    expect(maintenanceStatusTone("cancelled")).toBe("unknown");
  });

  it("does NOT render a live window as the neutral grey tone (regression)", () => {
    // The public surfaces hardcoded `status-unknown` for EVERY status, so a
    // scheduled window read grey publicly and blue everywhere else.
    expect(maintenanceStatusTone("scheduled")).not.toBe("unknown");
    expect(maintenanceStatusTone("in_progress")).not.toBe("unknown");
  });

  it("keeps grey for a cancelled window, which genuinely is inert", () => {
    expect(maintenanceStatusTone("cancelled")).toBe("unknown");
  });

  it("falls back to the grey unknown tone for unrecognized statuses", () => {
    expect(maintenanceStatusTone("weird")).toBe("unknown");
  });
});

describe("maintenanceStatusLabel", () => {
  it("matches the labels every other surface shows", () => {
    expect(maintenanceStatusLabel("in_progress")).toBe("In Progress");
    expect(maintenanceStatusLabel("scheduled")).toBe("Scheduled");
    expect(maintenanceStatusLabel("completed")).toBe("Completed");
    expect(maintenanceStatusLabel("cancelled")).toBe("Cancelled");
  });

  it("falls back to a readable form of an unrecognized status", () => {
    expect(maintenanceStatusLabel("some_state")).toBe("some state");
  });
});
