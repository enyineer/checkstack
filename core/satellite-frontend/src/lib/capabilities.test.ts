import { describe, it, expect } from "bun:test";
import {
  KNOWN_SATELLITE_CAPABILITIES,
  toCapabilityBadges,
  hasCapability,
} from "./capabilities";

describe("toCapabilityBadges", () => {
  it("returns no badges for an empty capability list", () => {
    expect(toCapabilityBadges([])).toEqual([]);
  });

  it("maps a known id to its label and description", () => {
    const [badge] = toCapabilityBadges(["telemetry-pull"]);
    expect(badge).toEqual({
      id: "telemetry-pull",
      label: "Telemetry pull",
      description: KNOWN_SATELLITE_CAPABILITIES.find(
        (c) => c.id === "telemetry-pull",
      )!
        .description,
      known: true,
    });
  });

  it("orders known capabilities canonically regardless of advertised order", () => {
    const badges = toCapabilityBadges(["syslog", "telemetry", "telemetry-pull"]);
    expect(badges.map((b) => b.id)).toEqual(["telemetry", "telemetry-pull", "syslog"]);
  });

  it("renders trace-receivers as a known labelled badge", () => {
    const [badge] = toCapabilityBadges(["trace-receivers"]);
    expect(badge).toEqual({
      id: "trace-receivers",
      label: "Trace receivers",
      description: KNOWN_SATELLITE_CAPABILITIES.find(
        (c) => c.id === "trace-receivers",
      )!.description,
      known: true,
    });
  });

  it("renders an unknown id as its own badge with a null description", () => {
    const badges = toCapabilityBadges(["mystery"]);
    expect(badges).toEqual([
      { id: "mystery", label: "mystery", description: null, known: false },
    ]);
  });

  it("places unknown ids after known ones, preserving advertised order", () => {
    const badges = toCapabilityBadges(["zeta", "telemetry-pull", "alpha"]);
    expect(badges.map((b) => b.id)).toEqual(["telemetry-pull", "zeta", "alpha"]);
    expect(badges.find((b) => b.id === "zeta")?.known).toBe(false);
  });

  it("collapses duplicate ids to a single badge", () => {
    expect(toCapabilityBadges(["scrape", "scrape"]).map((b) => b.id)).toEqual([
      "scrape",
    ]);
    expect(toCapabilityBadges(["x", "x"]).map((b) => b.id)).toEqual(["x"]);
  });
});

describe("hasCapability", () => {
  it("is true only when the id is advertised", () => {
    expect(hasCapability(["scrape", "telemetry"], "scrape")).toBe(true);
    expect(hasCapability(["telemetry"], "scrape")).toBe(false);
    expect(hasCapability([], "scrape")).toBe(false);
  });
});
