import { describe, expect, test } from "bun:test";
import {
  buildTypeAcquisitionPath,
  parseTypeAcquisitionPath,
  TYPE_ACQUISITION_PATH_PREFIX,
} from "./type-acquisition";

describe("buildTypeAcquisitionPath", () => {
  test("unscoped specifier", () => {
    expect(
      buildTypeAcquisitionPath({ lockfileHash: "abc123", specifier: "lodash" }),
    ).toBe(`${TYPE_ACQUISITION_PATH_PREFIX}/abc123/lodash`);
  });
  test("scoped specifier is percent-encoded into one segment", () => {
    const built = buildTypeAcquisitionPath({
      lockfileHash: "abc123",
      specifier: "@babel/core",
    });
    expect(built).toBe(`${TYPE_ACQUISITION_PATH_PREFIX}/abc123/%40babel%2Fcore`);
    // No un-encoded slash in the specifier segment.
    expect(built.split("/").length).toBe(4); // "", "types", hash, encodedSpec
  });
});

describe("parseTypeAcquisitionPath", () => {
  test("round-trips an unscoped specifier", () => {
    const parsed = parseTypeAcquisitionPath("/abc123/lodash");
    expect(parsed).toEqual({ lockfileHash: "abc123", specifier: "lodash" });
  });
  test("round-trips a scoped (encoded) specifier", () => {
    const parsed = parseTypeAcquisitionPath("/abc123/%40babel%2Fcore");
    expect(parsed).toEqual({
      lockfileHash: "abc123",
      specifier: "@babel/core",
    });
  });
  test("build -> parse round trip", () => {
    const path = buildTypeAcquisitionPath({
      lockfileHash: "deadbeef",
      specifier: "@scope/name",
    }).slice(TYPE_ACQUISITION_PATH_PREFIX.length);
    expect(parseTypeAcquisitionPath(path)).toEqual({
      lockfileHash: "deadbeef",
      specifier: "@scope/name",
    });
  });
  test("rejects an un-encoded extra slash (path traversal guard)", () => {
    expect(parseTypeAcquisitionPath("/abc123/foo/bar")).toBeUndefined();
  });
  test("rejects missing segments", () => {
    expect(parseTypeAcquisitionPath("/abc123")).toBeUndefined();
    expect(parseTypeAcquisitionPath("/abc123/")).toBeUndefined();
    expect(parseTypeAcquisitionPath("/")).toBeUndefined();
    expect(parseTypeAcquisitionPath("")).toBeUndefined();
  });
});
