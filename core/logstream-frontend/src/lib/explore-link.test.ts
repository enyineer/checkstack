import { describe, expect, it } from "bun:test";
import {
  buildExploreHref,
  EXPLORE_PARAMS,
  EXPLORE_TAB_VALUE,
} from "./explore-link";

describe("buildExploreHref", () => {
  it("targets the stream detail route with the explore tab and trace id", () => {
    expect(buildExploreHref({ streamId: "s1", traceId: "abc123" })).toBe(
      "/logstream/s1?tab=explore&traceId=abc123",
    );
  });

  it("includes the time window as ISO strings when given", () => {
    const from = new Date("2026-01-01T00:00:00.000Z");
    const to = new Date("2026-01-02T12:30:00.000Z");
    const href = buildExploreHref({ streamId: "s1", traceId: "t", from, to });
    const query = new URLSearchParams(href.split("?")[1]);
    expect(query.get(EXPLORE_PARAMS.tab)).toBe(EXPLORE_TAB_VALUE);
    expect(query.get(EXPLORE_PARAMS.traceId)).toBe("t");
    expect(query.get(EXPLORE_PARAMS.from)).toBe(from.toISOString());
    expect(query.get(EXPLORE_PARAMS.to)).toBe(to.toISOString());
  });

  it("omits facets that are not provided", () => {
    const href = buildExploreHref({ streamId: "s1" });
    const query = new URLSearchParams(href.split("?")[1]);
    expect(query.get(EXPLORE_PARAMS.tab)).toBe(EXPLORE_TAB_VALUE);
    expect(query.has(EXPLORE_PARAMS.traceId)).toBe(false);
    expect(query.has(EXPLORE_PARAMS.from)).toBe(false);
    expect(query.has(EXPLORE_PARAMS.to)).toBe(false);
  });

  it("url-encodes a trace id with unsafe characters", () => {
    const href = buildExploreHref({ streamId: "s1", traceId: "a b/c" });
    // URLSearchParams encodes the value; decoding round-trips it.
    const query = new URLSearchParams(href.split("?")[1]);
    expect(query.get(EXPLORE_PARAMS.traceId)).toBe("a b/c");
    expect(href).not.toContain("a b/c");
  });
});
