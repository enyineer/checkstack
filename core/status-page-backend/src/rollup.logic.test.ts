import { describe, test, expect } from "bun:test";
import {
  mapHealthStatus,
  rollupStatus,
  overallBannerStatus,
  statusBannerTitle,
} from "./rollup.logic";

describe("mapHealthStatus", () => {
  test("maps the internal health enum to the public vocabulary", () => {
    expect(mapHealthStatus("healthy")).toBe("operational");
    expect(mapHealthStatus("degraded")).toBe("degraded");
    expect(mapHealthStatus("unhealthy")).toBe("major_outage");
    expect(mapHealthStatus("weird")).toBe("unknown");
  });
});

describe("rollupStatus", () => {
  test("empty -> unknown", () => {
    expect(rollupStatus([])).toBe("unknown");
  });
  test("all operational -> operational", () => {
    expect(rollupStatus(["operational", "operational"])).toBe("operational");
  });
  test("a major outage dominates everything", () => {
    expect(
      rollupStatus(["operational", "degraded", "maintenance", "major_outage"]),
    ).toBe("major_outage");
  });
  test("maintenance ranks above degraded but below outages", () => {
    expect(rollupStatus(["degraded", "maintenance"])).toBe("maintenance");
    expect(rollupStatus(["maintenance", "partial_outage"])).toBe(
      "partial_outage",
    );
  });
  test("unknown only wins when nothing else is present", () => {
    expect(rollupStatus(["operational", "unknown"])).toBe("operational");
    expect(rollupStatus(["unknown", "unknown"])).toBe("unknown");
  });
});

describe("overallBannerStatus", () => {
  test("all operational -> operational; empty/all-unknown -> unknown", () => {
    expect(overallBannerStatus(["operational", "operational"])).toBe("operational");
    expect(overallBannerStatus([])).toBe("unknown");
    expect(overallBannerStatus(["unknown", "unknown"])).toBe("unknown");
  });
  test("SOME (not all) systems down -> partial_outage", () => {
    expect(overallBannerStatus(["operational", "major_outage"])).toBe(
      "partial_outage",
    );
    expect(
      overallBannerStatus(["major_outage", "degraded", "operational"]),
    ).toBe("partial_outage");
  });
  test("ALL known systems down -> major_outage (ignoring unknowns)", () => {
    expect(overallBannerStatus(["major_outage", "major_outage"])).toBe(
      "major_outage",
    );
    expect(overallBannerStatus(["major_outage", "unknown"])).toBe("major_outage");
  });
  test("no hard outages -> worst of the rest", () => {
    expect(overallBannerStatus(["degraded", "operational"])).toBe("degraded");
    expect(overallBannerStatus(["maintenance", "degraded"])).toBe("maintenance");
  });
});

describe("statusBannerTitle", () => {
  test("operational reads 'All systems operational'", () => {
    expect(statusBannerTitle("operational")).toBe("All systems operational");
    expect(statusBannerTitle("major_outage")).toBe("Major system outage");
  });
});
