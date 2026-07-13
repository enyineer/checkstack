import { describe, it, expect } from "bun:test";
import type { SatelliteWithStatus } from "@checkstack/satellite-common";
import {
  buildScrapeFromOptions,
  toScrapeFromValue,
  fromScrapeFromValue,
  resolveScrapeSourceBadge,
  CORE_SCRAPE_VALUE,
  SCRAPE_DISABLED_HINT,
} from "./scrape-from";

function sat(
  overrides: Partial<SatelliteWithStatus> & { id: string; name: string },
): SatelliteWithStatus {
  return {
    region: "eu-west-1",
    tags: {},
    capabilities: [],
    status: "online",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

const scraper = sat({ id: "s1", name: "EU West", capabilities: ["scrape"] });
const telemetryOnly = sat({
  id: "s2",
  name: "US East",
  capabilities: ["telemetry"],
});

describe("buildScrapeFromOptions", () => {
  it("always leads with a selectable Core option", () => {
    const [core] = buildScrapeFromOptions([]);
    expect(core).toEqual({
      value: CORE_SCRAPE_VALUE,
      label: "Core (this server)",
      disabled: false,
      hint: null,
      isCore: true,
    });
  });

  it("offers a scrape-capable satellite as selectable with no hint", () => {
    const opts = buildScrapeFromOptions([scraper]);
    expect(opts[1]).toEqual({
      value: "s1",
      label: "EU West",
      disabled: false,
      hint: null,
      isCore: false,
    });
  });

  it("disables a satellite lacking the scrape capability, with a hint", () => {
    const opts = buildScrapeFromOptions([telemetryOnly]);
    expect(opts[1]).toEqual({
      value: "s2",
      label: "US East",
      disabled: true,
      hint: SCRAPE_DISABLED_HINT,
      isCore: false,
    });
  });

  it("preserves satellite input order after the core option", () => {
    const opts = buildScrapeFromOptions([telemetryOnly, scraper]);
    expect(opts.map((o) => o.value)).toEqual([
      CORE_SCRAPE_VALUE,
      "s2",
      "s1",
    ]);
  });
});

describe("scrape-from value mapping", () => {
  it("maps null (core) to the sentinel and back", () => {
    expect(toScrapeFromValue(null)).toBe(CORE_SCRAPE_VALUE);
    expect(fromScrapeFromValue(CORE_SCRAPE_VALUE)).toBeNull();
  });

  it("maps a satellite id through unchanged", () => {
    expect(toScrapeFromValue("s1")).toBe("s1");
    expect(fromScrapeFromValue("s1")).toBe("s1");
  });
});

describe("resolveScrapeSourceBadge", () => {
  it("labels a core-bound target as Core", () => {
    expect(
      resolveScrapeSourceBadge({ satelliteId: null, satellites: [scraper] }),
    ).toEqual({ label: "Core", isSatellite: false, isUnknownSatellite: false });
  });

  it("labels a satellite-bound target with the satellite name", () => {
    expect(
      resolveScrapeSourceBadge({ satelliteId: "s1", satellites: [scraper] }),
    ).toEqual({
      label: "EU West",
      isSatellite: true,
      isUnknownSatellite: false,
    });
  });

  it("falls back to a neutral Satellite label for an unresolvable id", () => {
    expect(
      resolveScrapeSourceBadge({ satelliteId: "gone", satellites: [scraper] }),
    ).toEqual({
      label: "Satellite",
      isSatellite: true,
      isUnknownSatellite: true,
    });
  });
});
