import { describe, test, expect } from "bun:test";
import {
  mapHealthStatus,
  rollupStatus,
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

describe("statusBannerTitle", () => {
  test("operational reads 'All systems operational'", () => {
    expect(statusBannerTitle("operational")).toBe("All systems operational");
    expect(statusBannerTitle("major_outage")).toBe("Major system outage");
  });
});
