import { describe, it, expect } from "bun:test";
import {
  computeCapabilities,
  removedScrapeEnvWarning,
  REMOVED_SCRAPE_ENV_VAR,
  SATELLITE_CAPABILITY_FLAGS,
} from "./capabilities";

describe("removedScrapeEnvWarning", () => {
  it("warns when the removed scrape env var is set", () => {
    const message = removedScrapeEnvWarning({ [REMOVED_SCRAPE_ENV_VAR]: "1" });
    expect(message).toContain(REMOVED_SCRAPE_ENV_VAR);
    // Points at the replacement capability's flag.
    expect(message).toContain(SATELLITE_CAPABILITY_FLAGS["telemetry-pull"]);
  });

  it("returns null when the var is unset or blank", () => {
    expect(removedScrapeEnvWarning({})).toBeNull();
    expect(removedScrapeEnvWarning({ [REMOVED_SCRAPE_ENV_VAR]: "" })).toBeNull();
    expect(removedScrapeEnvWarning({ [REMOVED_SCRAPE_ENV_VAR]: "   " })).toBeNull();
  });

  it("does not advertise a capability for the removed var", () => {
    // The removed flag is not one of the capability flags, so setting it never
    // advertises anything.
    expect(computeCapabilities({ [REMOVED_SCRAPE_ENV_VAR]: "1" })).toEqual([]);
  });
});
