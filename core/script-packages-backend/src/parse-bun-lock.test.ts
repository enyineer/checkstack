import { describe, expect, test } from "bun:test";
import { parseBunLock, splitSpec } from "./parse-bun-lock";

describe("splitSpec", () => {
  test("splits a plain spec", () => {
    expect(splitSpec("leftpad@0.0.1")).toEqual({
      name: "leftpad",
      version: "0.0.1",
    });
  });
  test("splits a scoped spec", () => {
    expect(splitSpec("@acme/utils@1.2.3")).toEqual({
      name: "@acme/utils",
      version: "1.2.3",
    });
  });
  test("rejects a bare name", () => {
    expect(splitSpec("leftpad")).toBeUndefined();
  });
});

const LOCK = `{
  "lockfileVersion": 1,
  "packages": {
    "leftpad": ["leftpad@0.0.1", "", {}, "sha512-AAA=="],
    "@acme/utils": ["@acme/utils@1.2.3", "", { "dependencies": {} }, "sha512-BBB=="],
  }
}`;

describe("parseBunLock", () => {
  test("extracts name/version/integrity for each package", () => {
    const entries = parseBunLock(LOCK);
    expect(entries).toHaveLength(2);
    const left = entries.find((e) => e.name === "leftpad");
    expect(left).toEqual({
      name: "leftpad",
      version: "0.0.1",
      integrity: "sha512-AAA==",
    });
    const acme = entries.find((e) => e.name === "@acme/utils");
    expect(acme?.integrity).toBe("sha512-BBB==");
  });

  test("dedupes by integrity", () => {
    const dup = `{ "packages": {
      "a": ["a@1.0.0", "", {}, "sha512-SAME=="],
      "b": ["b@1.0.0", "", {}, "sha512-SAME=="]
    } }`;
    expect(parseBunLock(dup)).toHaveLength(1);
  });

  test("skips entries without an sri integrity", () => {
    const lock = `{ "packages": {
      "ws": ["ws@1.0.0", "", {}, "workspace"]
    } }`;
    expect(parseBunLock(lock)).toHaveLength(0);
  });

  test("throws on invalid lockfile text", () => {
    expect(() => parseBunLock("not json {{{")).toThrow(/invalid lockfile/i);
  });
});
