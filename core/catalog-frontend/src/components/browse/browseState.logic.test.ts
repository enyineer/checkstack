import { describe, expect, test } from "bun:test";
import {
  parseBrowseState,
  serializeBrowseState,
  parseOpenParam,
  serializeOpenParam,
  DEFAULT_BROWSE_STATE,
  BROWSE_PARAM,
} from "./browseState.logic";

/** Build a `params.get`-style reader from a plain record. */
function reader(record: Record<string, string>) {
  return { get: (key: string): string | null => record[key] ?? null };
}

describe("parseBrowseState", () => {
  test("returns defaults for empty params", () => {
    expect(parseBrowseState(reader({}))).toEqual(DEFAULT_BROWSE_STATE);
  });

  test("parses all params", () => {
    const state = parseBrowseState(
      reader({
        [BROWSE_PARAM.query]: "checkout",
        [BROWSE_PARAM.group]: "payments",
        [BROWSE_PARAM.health]: "degraded",
        [BROWSE_PARAM.tag]: "team=payments",
        [BROWSE_PARAM.density]: "compact",
        [BROWSE_PARAM.open]: "payments,-platform",
      }),
    );
    expect(state).toEqual({
      query: "checkout",
      group: "payments",
      health: "degraded",
      tag: "team=payments",
      density: "compact",
      open: { payments: true, platform: false },
    });
  });

  test("falls back to default for invalid health/density enums", () => {
    const state = parseBrowseState(
      reader({ [BROWSE_PARAM.health]: "bogus", [BROWSE_PARAM.density]: "huge" }),
    );
    expect(state.health).toBe("all");
    expect(state.density).toBe("comfortable");
  });

  test("treats empty group/tag strings as null", () => {
    const state = parseBrowseState(
      reader({ [BROWSE_PARAM.group]: "", [BROWSE_PARAM.tag]: "" }),
    );
    expect(state.group).toBeNull();
    expect(state.tag).toBeNull();
  });
});

describe("open param round-trip", () => {
  test("parseOpenParam handles forced-open and forced-closed", () => {
    expect(parseOpenParam("a,-b,c")).toEqual({ a: true, b: false, c: true });
  });

  test("parseOpenParam ignores blank/empty tokens", () => {
    expect(parseOpenParam(" , ,-")).toEqual({});
    expect(parseOpenParam(null)).toEqual({});
    expect(parseOpenParam("")).toEqual({});
  });

  test("serializeOpenParam is sorted and deterministic", () => {
    expect(serializeOpenParam({ c: true, a: false, b: true })).toBe("-a,b,c");
  });

  test("open map survives a full round-trip", () => {
    const open = { payments: true, platform: false, infra: true };
    expect(parseOpenParam(serializeOpenParam(open))).toEqual(open);
  });
});

describe("serializeBrowseState", () => {
  test("default state produces all-empty (no params)", () => {
    const out = serializeBrowseState(DEFAULT_BROWSE_STATE);
    expect(out).toEqual({
      [BROWSE_PARAM.query]: "",
      [BROWSE_PARAM.group]: "",
      [BROWSE_PARAM.health]: "",
      [BROWSE_PARAM.tag]: "",
      [BROWSE_PARAM.density]: "",
      [BROWSE_PARAM.open]: "",
    });
  });

  test("non-default values are emitted", () => {
    const out = serializeBrowseState({
      query: "api",
      group: "g1",
      health: "unhealthy",
      tag: "tier=1",
      density: "compact",
      open: { g1: true },
    });
    expect(out[BROWSE_PARAM.query]).toBe("api");
    expect(out[BROWSE_PARAM.group]).toBe("g1");
    expect(out[BROWSE_PARAM.health]).toBe("unhealthy");
    expect(out[BROWSE_PARAM.tag]).toBe("tier=1");
    expect(out[BROWSE_PARAM.density]).toBe("compact");
    expect(out[BROWSE_PARAM.open]).toBe("g1");
  });

  test("parse(serialize(state)) round-trips a non-default state", () => {
    const state = {
      query: "checkout",
      group: "payments",
      health: "degraded" as const,
      tag: "team=payments",
      density: "compact" as const,
      open: { payments: true, platform: false },
    };
    const serialized = serializeBrowseState(state);
    const filled = Object.fromEntries(
      Object.entries(serialized).filter(([, v]) => v.length > 0),
    );
    expect(parseBrowseState(reader(filled))).toEqual(state);
  });
});
