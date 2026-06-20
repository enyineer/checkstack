import { describe, expect, test } from "bun:test";
import {
  classifyTtlUrgency,
  maxByteSize,
  sizeBarWidthPercent,
} from "./cacheDisplay.logic";

describe("classifyTtlUrgency", () => {
  const now = 1_000_000;

  test("no expiry is neutral", () => {
    expect(classifyTtlUrgency({ expiresAt: null, now })).toBe("neutral");
    expect(classifyTtlUrgency({ expiresAt: undefined, now })).toBe("neutral");
  });

  test("already expired is down", () => {
    expect(classifyTtlUrgency({ expiresAt: new Date(now), now })).toBe("down");
    expect(
      classifyTtlUrgency({ expiresAt: new Date(now - 1000), now }),
    ).toBe("down");
  });

  test("under a minute remaining is warn", () => {
    expect(
      classifyTtlUrgency({ expiresAt: new Date(now + 1000), now }),
    ).toBe("warn");
    expect(
      classifyTtlUrgency({ expiresAt: new Date(now + 60_000), now }),
    ).toBe("warn");
  });

  test("more than a minute remaining is neutral", () => {
    expect(
      classifyTtlUrgency({ expiresAt: new Date(now + 60_001), now }),
    ).toBe("neutral");
    expect(
      classifyTtlUrgency({ expiresAt: new Date(now + 3_600_000), now }),
    ).toBe("neutral");
  });
});

describe("maxByteSize", () => {
  test("empty or all-null is zero", () => {
    expect(maxByteSize({ entries: [] })).toBe(0);
    expect(
      maxByteSize({ entries: [{ byteSize: null }, { byteSize: undefined }] }),
    ).toBe(0);
  });

  test("largest non-null wins", () => {
    expect(
      maxByteSize({
        entries: [{ byteSize: 10 }, { byteSize: null }, { byteSize: 42 }],
      }),
    ).toBe(42);
  });
});

describe("sizeBarWidthPercent", () => {
  test("null byteSize renders no bar", () => {
    expect(sizeBarWidthPercent({ byteSize: null, maxByteSize: 100 })).toBeNull();
    expect(
      sizeBarWidthPercent({ byteSize: undefined, maxByteSize: 100 }),
    ).toBeNull();
  });

  test("non-positive max renders no bar", () => {
    expect(sizeBarWidthPercent({ byteSize: 10, maxByteSize: 0 })).toBeNull();
  });

  test("zero size stays zero", () => {
    expect(sizeBarWidthPercent({ byteSize: 0, maxByteSize: 100 })).toBe(0);
  });

  test("proportional and clamped to 100", () => {
    expect(sizeBarWidthPercent({ byteSize: 50, maxByteSize: 100 })).toBe(50);
    expect(sizeBarWidthPercent({ byteSize: 100, maxByteSize: 100 })).toBe(100);
    expect(sizeBarWidthPercent({ byteSize: 200, maxByteSize: 100 })).toBe(100);
  });

  test("small non-zero floors to a faintly visible 2%", () => {
    expect(sizeBarWidthPercent({ byteSize: 1, maxByteSize: 100_000 })).toBe(2);
  });
});
