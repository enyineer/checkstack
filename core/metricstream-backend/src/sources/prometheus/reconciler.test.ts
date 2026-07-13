import { describe, it, expect } from "bun:test";
import { scrapeJobId, SCRAPE_JOB_PREFIX } from "./reconciler";

describe("scrapeJobId", () => {
  it("encodes the target id and interval so an interval change reschedules", () => {
    expect(scrapeJobId({ targetId: "abc", intervalSeconds: 30 })).toBe(
      `${SCRAPE_JOB_PREFIX}abc:30`,
    );
    expect(scrapeJobId({ targetId: "abc", intervalSeconds: 60 })).not.toBe(
      scrapeJobId({ targetId: "abc", intervalSeconds: 30 }),
    );
  });
});
