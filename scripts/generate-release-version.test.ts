import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  readReleaseVersion,
  renderReleaseVersionModule,
} from "./generate-release-version";

function writePackageJson(contents: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "release-version-"));
  const file = path.join(dir, "package.json");
  writeFileSync(file, contents, "utf8");
  return file;
}

describe("readReleaseVersion", () => {
  test("reads the version from the release package", () => {
    const file = writePackageJson(
      JSON.stringify({ name: "@checkstack/release", version: "0.136.0" }),
    );

    expect(readReleaseVersion({ packageJsonPath: file })).toBe("0.136.0");
  });

  test("throws rather than emitting a bogus constant when version is missing", () => {
    // Failing loudly at generation time beats shipping "vundefined" to the
    // About page, where nobody would notice until a user reported it.
    const file = writePackageJson(JSON.stringify({ name: "x" }));

    expect(() => readReleaseVersion({ packageJsonPath: file })).toThrow(
      /no usable "version" field/,
    );
  });

  test("throws on a non-string version", () => {
    const file = writePackageJson(JSON.stringify({ version: 136 }));

    expect(() => readReleaseVersion({ packageJsonPath: file })).toThrow();
  });

  test("throws on an empty version", () => {
    const file = writePackageJson(JSON.stringify({ version: "" }));

    expect(() => readReleaseVersion({ packageJsonPath: file })).toThrow();
  });
});

describe("renderReleaseVersionModule", () => {
  test("emits the version as a quoted constant", () => {
    const output = renderReleaseVersionModule({ version: "1.2.3" });

    expect(output).toContain('export const RELEASE_VERSION = "1.2.3";');
  });

  test("marks the file as generated so nobody hand-edits it", () => {
    expect(renderReleaseVersionModule({ version: "1.2.3" })).toContain(
      "GENERATED FILE - DO NOT EDIT",
    );
  });

  test("is deterministic, so --check only fails on a genuine drift", () => {
    expect(renderReleaseVersionModule({ version: "1.2.3" })).toBe(
      renderReleaseVersionModule({ version: "1.2.3" }),
    );
  });
});
