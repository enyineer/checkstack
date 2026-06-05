import { describe, expect, test } from "bun:test";
import {
  buildSdkTypesPath,
  parseSdkTypesPath,
  SDK_TYPES_PATH_PREFIX,
} from "./sdk-types-path";

describe("buildSdkTypesPath", () => {
  test("plain semver version", () => {
    expect(buildSdkTypesPath({ releaseVersion: "0.93.0" })).toBe(
      `${SDK_TYPES_PATH_PREFIX}/0.93.0`,
    );
  });
  test("pre-release / build-metadata version is percent-encoded into one segment", () => {
    const built = buildSdkTypesPath({ releaseVersion: "1.2.3-rc.1+build" });
    expect(built).toBe(`${SDK_TYPES_PATH_PREFIX}/1.2.3-rc.1%2Bbuild`);
    // No un-encoded slash anywhere after the prefix.
    expect(built.slice(SDK_TYPES_PATH_PREFIX.length + 1).includes("/")).toBe(
      false,
    );
  });
});

describe("parseSdkTypesPath", () => {
  test("round-trips a plain version", () => {
    expect(parseSdkTypesPath("/0.93.0")).toEqual({ releaseVersion: "0.93.0" });
  });
  test("round-trips an encoded version", () => {
    expect(parseSdkTypesPath("/1.2.3-rc.1%2Bbuild")).toEqual({
      releaseVersion: "1.2.3-rc.1+build",
    });
  });
  test("build -> parse round trip", () => {
    const path = buildSdkTypesPath({ releaseVersion: "9.9.9+meta" }).slice(
      SDK_TYPES_PATH_PREFIX.length,
    );
    expect(parseSdkTypesPath(path)).toEqual({ releaseVersion: "9.9.9+meta" });
  });
  test("tolerates a missing leading slash", () => {
    expect(parseSdkTypesPath("0.93.0")).toEqual({ releaseVersion: "0.93.0" });
  });
  test("rejects an un-encoded extra slash (path traversal guard)", () => {
    expect(parseSdkTypesPath("/0.93.0/extra")).toBeUndefined();
    expect(parseSdkTypesPath("/../etc/passwd")).toBeUndefined();
  });
  test("rejects empty segments", () => {
    expect(parseSdkTypesPath("/")).toBeUndefined();
    expect(parseSdkTypesPath("")).toBeUndefined();
  });
});
