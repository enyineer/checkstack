import { describe, it, expect } from "bun:test";
import {
  resolveSeverity,
  applySeverityValueMap,
  truncateBody,
  capAttributes,
  bodyToString,
} from "./normalize";

describe("resolveSeverity", () => {
  it("prefers a recognized level name for the band, keeping the OTel number", () => {
    expect(resolveSeverity({ severityNumber: 17, level: "ERROR" })).toEqual({
      band: "error",
      severityNumber: 17,
      severityText: "ERROR",
    });
  });

  it("bands a numeric OTel severity when no name is given", () => {
    expect(resolveSeverity({ severityNumber: 21 })).toEqual({
      band: "fatal",
      severityNumber: 21,
      severityText: undefined,
    });
  });

  it("maps a bare level name to its representative number", () => {
    expect(resolveSeverity({ level: "warning" })).toEqual({
      band: "warn",
      severityNumber: 14,
      severityText: "warning",
    });
  });

  it("treats a numeric level (number or string) as an OTel number", () => {
    expect(resolveSeverity({ level: 13 }).band).toBe("warn");
    expect(resolveSeverity({ level: "13" }).band).toBe("warn");
    // A purely numeric level is not kept as free-text severityText.
    expect(resolveSeverity({ level: "13" }).severityText).toBeUndefined();
  });

  it("defaults unknown / empty severities to info with number 0", () => {
    expect(resolveSeverity({ level: "bogus" })).toEqual({
      band: "info",
      severityNumber: 0,
      severityText: "bogus",
    });
    expect(resolveSeverity({})).toEqual({
      band: "info",
      severityNumber: 0,
      severityText: undefined,
    });
  });

  it("ignores an OTel 0 (unspecified) and falls through to the name", () => {
    expect(resolveSeverity({ severityNumber: 0, level: "debug" }).band).toBe(
      "debug",
    );
  });
});

describe("truncateBody", () => {
  it("returns short bodies unchanged", () => {
    expect(truncateBody({ body: "hello", maxBytes: 100 })).toBe("hello");
  });

  it("truncates to the byte budget without splitting a code point", () => {
    // Each "€" is 3 UTF-8 bytes. Budget of 7 fits two (6 bytes), drops the third.
    const out = truncateBody({ body: "€€€", maxBytes: 7 });
    expect(out).toBe("€€");
    expect(new TextEncoder().encode(out).length).toBeLessThanOrEqual(7);
  });
});

describe("capAttributes", () => {
  it("returns undefined for empty / missing input", () => {
    expect(capAttributes({ attributes: undefined })).toBeUndefined();
    expect(capAttributes({ attributes: {} })).toBeUndefined();
  });

  it("passes small objects through untouched", () => {
    const attrs = { a: 1, b: "x" };
    expect(capAttributes({ attributes: attrs })).toEqual(attrs);
  });

  it("drops overflow keys and marks the object truncated", () => {
    const big = "x".repeat(200);
    const attrs = { a: big, b: big, c: big };
    const out = capAttributes({ attributes: attrs, maxBytes: 250 })!;
    expect(out._truncated).toBe(true);
    expect(new TextEncoder().encode(JSON.stringify(out)).length).toBeLessThanOrEqual(
      250,
    );
  });
});

describe("bodyToString", () => {
  it("passes strings, stringifies scalars, and JSON-encodes objects", () => {
    expect(bodyToString("hi")).toBe("hi");
    expect(bodyToString(42)).toBe("42");
    expect(bodyToString(true)).toBe("true");
    expect(bodyToString(null)).toBe("");
    expect(bodyToString({ a: 1 })).toBe('{"a":1}');
  });
});

describe("applySeverityValueMap", () => {
  it("overrides the default band when the raw value matches (precedence)", () => {
    // Source value "WARNING" would resolve to `warn` by default; the stream maps
    // it to `error`, and that mapping WINS.
    expect(
      applySeverityValueMap({
        band: "warn",
        rawValue: "WARNING",
        valueMap: { WARNING: "error" },
      }),
    ).toBe("error");
  });

  it("matches case-insensitively across the map key and the raw value", () => {
    expect(
      applySeverityValueMap({
        band: "info",
        rawValue: "Notice",
        valueMap: { NOTICE: "warn" },
      }),
    ).toBe("warn");
    expect(
      applySeverityValueMap({
        band: "info",
        rawValue: "  alert  ",
        valueMap: { Alert: "fatal" },
      }),
    ).toBe("fatal");
  });

  it("maps a numeric raw severity value by its string form", () => {
    expect(
      applySeverityValueMap({
        band: "debug",
        rawValue: 5,
        valueMap: { "5": "error" },
      }),
    ).toBe("error");
  });

  it("returns the original band when there is no match, no map, or an empty value", () => {
    expect(
      applySeverityValueMap({
        band: "info",
        rawValue: "unmapped",
        valueMap: { WARNING: "error" },
      }),
    ).toBe("info");
    expect(
      applySeverityValueMap({ band: "warn", rawValue: "x", valueMap: undefined }),
    ).toBe("warn");
    expect(
      applySeverityValueMap({
        band: "warn",
        rawValue: undefined,
        valueMap: { WARNING: "error" },
      }),
    ).toBe("warn");
  });

  it("keeps first-match-wins for keys that collide after lowercasing", () => {
    // The map is lowered into a lookup ONCE; the earlier key must win the
    // collision, matching the old linear-scan first-match behavior.
    const valueMap = { Err: "fatal", ERR: "warn" } as const;
    expect(
      applySeverityValueMap({ band: "error", rawValue: "err", valueMap }),
    ).toBe("fatal");
    // A second call reuses the memoized lowered map and stays consistent.
    expect(
      applySeverityValueMap({ band: "error", rawValue: "ERR", valueMap }),
    ).toBe("fatal");
  });
});
