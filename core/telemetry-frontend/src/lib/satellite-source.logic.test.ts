import { describe, it, expect } from "bun:test";
import type { SatelliteWithStatus } from "@checkstack/satellite-common";
import {
  buildRunFromOptions,
  fromRunFromValue,
  toRunFromValue,
  CORE_SATELLITE_VALUE,
  TELEMETRY_PULL_CAPABILITY,
} from "./satellite-source.logic";

const sat = (
  over: Partial<SatelliteWithStatus> & { id: string },
): SatelliteWithStatus =>
  ({
    name: over.id,
    capabilities: [],
    ...over,
  }) as SatelliteWithStatus;

describe("buildRunFromOptions", () => {
  it("puts a selectable core option first", () => {
    const [core] = buildRunFromOptions([]);
    expect(core.value).toBe(CORE_SATELLITE_VALUE);
    expect(core.isCore).toBe(true);
    expect(core.disabled).toBe(false);
  });

  it("enables only satellites advertising the telemetry-pull capability", () => {
    const options = buildRunFromOptions([
      sat({ id: "cap", capabilities: [TELEMETRY_PULL_CAPABILITY] }),
      sat({ id: "nope", capabilities: ["scrape"] }),
    ]);
    const cap = options.find((o) => o.value === "cap");
    const nope = options.find((o) => o.value === "nope");
    expect(cap?.disabled).toBe(false);
    expect(cap?.hint).toBeNull();
    expect(nope?.disabled).toBe(true);
    expect(nope?.hint).toBeTruthy();
  });
});

describe("run-from value mapping", () => {
  it("maps null <-> the core sentinel", () => {
    expect(toRunFromValue(null)).toBe(CORE_SATELLITE_VALUE);
    expect(toRunFromValue("sat-1")).toBe("sat-1");
    expect(fromRunFromValue(CORE_SATELLITE_VALUE)).toBeNull();
    expect(fromRunFromValue("sat-1")).toBe("sat-1");
  });
});
