import { describe, expect, test } from "bun:test";
import { isDependencyOnlyChangelog } from "./aggregate-changelog";

describe("isDependencyOnlyChangelog", () => {
  test("returns true for changelog with only Updated dependencies entries", () => {
    const changelog = `### Patch Changes

- Updated dependencies [4eed42d]
  - @checkstack/frontend-api@0.3.0`;

    expect(isDependencyOnlyChangelog(changelog)).toBe(true);
  });

  test("returns true for changelog with multiple Updated dependencies entries", () => {
    const changelog = `### Patch Changes

- Updated dependencies [4eed42d]
  - @checkstack/frontend-api@0.3.0
- Updated dependencies [7a23261]
  - @checkstack/common@0.3.0`;

    expect(isDependencyOnlyChangelog(changelog)).toBe(true);
  });

  test("returns false for changelog with actual changes", () => {
    const changelog = `### Minor Changes

- 7a23261: ## TanStack Query Integration

  Migrated all frontend components to use \`usePluginClient\` hook.`;

    expect(isDependencyOnlyChangelog(changelog)).toBe(false);
  });

  test("returns false for changelog with mixed changes and dependencies", () => {
    const changelog = `### Minor Changes

- 7a23261: ## TanStack Query Integration

  Migrated all frontend components to use \`usePluginClient\` hook.

### Patch Changes

- Updated dependencies [7a23261]
  - @checkstack/frontend-api@0.2.0`;

    expect(isDependencyOnlyChangelog(changelog)).toBe(false);
  });

  test("returns true for empty changelog", () => {
    expect(isDependencyOnlyChangelog("")).toBe(true);
  });

  test("returns true for changelog with only headers and no bullet points", () => {
    const changelog = `### Patch Changes

`;
    expect(isDependencyOnlyChangelog(changelog)).toBe(true);
  });

  test("handles changelog with patch description (not dependency)", () => {
    const changelog = `### Patch Changes

- d20d274: Initial release of all @checkstack packages.`;

    expect(isDependencyOnlyChangelog(changelog)).toBe(false);
  });

  test("handles major changes correctly", () => {
    const changelog = `### Major Changes

- 8e43507: BREAKING: \`getSystems\` now returns \`{ systems: [...] }\` instead of plain array`;

    expect(isDependencyOnlyChangelog(changelog)).toBe(false);
  });
});

describe("getPreviousReleaseVersion", () => {
  // We use a mock approach by testing the core logic that would be used
  // The actual function reads from the filesystem, so we test the extraction logic

  function extractPreviousVersion(
    changelogContent: string,
    currentVersion: string,
  ): string | undefined {
    const lines = changelogContent.split("\n");
    let foundCurrent = false;
    for (const line of lines) {
      if (line.startsWith("## ")) {
        const version = line.replace("## ", "").trim();
        if (version === currentVersion) {
          foundCurrent = true;
          continue;
        }
        if (foundCurrent) {
          return version;
        }
      }
    }
    return undefined;
  }

  test("returns the version before the current one", () => {
    const changelog = `# @checkstack/release

## 0.10.0

### Minor Changes

- dd07c14: Some change

## 0.9.0

### Minor Changes

- df6ac7b: Another change

## 0.8.0

### Minor Changes

- 4eed42d: Earlier change`;

    expect(extractPreviousVersion(changelog, "0.10.0")).toBe("0.9.0");
  });

  test("returns undefined for the first version", () => {
    const changelog = `# @checkstack/release

## 0.1.0

### Minor Changes

- d20d274: Initial release`;

    expect(extractPreviousVersion(changelog, "0.1.0")).toBe(undefined);
  });

  test("returns undefined if current version not found", () => {
    const changelog = `# @checkstack/release

## 0.5.0

### Minor Changes

- abc1234: Some change`;

    expect(extractPreviousVersion(changelog, "0.10.0")).toBe(undefined);
  });

  test("handles middle version correctly", () => {
    const changelog = `# @checkstack/release

## 0.10.0

### Minor Changes

- dd07c14: Some change

## 0.9.0

### Minor Changes

- df6ac7b: Another change

## 0.8.0

### Minor Changes

- 4eed42d: Earlier change`;

    expect(extractPreviousVersion(changelog, "0.9.0")).toBe("0.8.0");
  });
});
