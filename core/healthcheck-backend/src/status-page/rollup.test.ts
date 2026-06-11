import { describe, test, expect } from "bun:test";
import {
  mapHealthStatus,
  rollupStatus,
  overallBannerStatus,
  statusBannerTitle,
} from "./rollup";

describe("mapHealthStatus", () => {
  test("maps the internal health enum to the public vocabulary", () => {
    expect(mapHealthStatus("healthy")).toBe("operational");
    expect(mapHealthStatus("degraded")).toBe("degraded");
    expect(mapHealthStatus("unhealthy")).toBe("major_outage");
    expect(mapHealthStatus("weird")).toBe("unknown");
  });
});

describe("rollupStatus", () => {
  test("empty -> unknown; all operational -> operational", () => {
    expect(rollupStatus([])).toBe("unknown");
    expect(rollupStatus(["operational", "operational"])).toBe("operational");
  });
  test("a major outage dominates; maintenance ranks above degraded", () => {
    expect(rollupStatus(["operational", "major_outage"])).toBe("major_outage");
    expect(rollupStatus(["degraded", "maintenance"])).toBe("maintenance");
  });
});

describe("overallBannerStatus", () => {
  test("SOME down -> partial_outage; ALL down -> major_outage", () => {
    expect(overallBannerStatus(["operational", "major_outage"])).toBe(
      "partial_outage",
    );
    expect(overallBannerStatus(["major_outage", "major_outage"])).toBe(
      "major_outage",
    );
    expect(overallBannerStatus(["major_outage", "unknown"])).toBe(
      "major_outage",
    );
  });
  test("no hard outages -> worst of the rest; empty/unknown -> unknown", () => {
    expect(overallBannerStatus(["degraded", "operational"])).toBe("degraded");
    expect(overallBannerStatus([])).toBe("unknown");
    expect(overallBannerStatus(["unknown"])).toBe("unknown");
  });
});

describe("statusBannerTitle", () => {
  test("renders a human title", () => {
    expect(statusBannerTitle("operational")).toBe("All systems operational");
    expect(statusBannerTitle("partial_outage")).toBe("Partial system outage");
  });
});
