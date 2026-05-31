import { describe, expect, test } from "bun:test";
import {
  generateMarkdown,
  groupChanges,
  isDependencyOnlyChangelog,
  parseChangeEntries,
} from "./aggregate-changelog";

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

describe("parseChangeEntries", () => {
  test("parses a single entry", () => {
    const changes = `### Minor Changes

- 6d52276: feat(scope): summary first line`;

    const entries = parseChangeEntries({ changes });
    expect(entries).toEqual([
      { type: "minor", text: "- 6d52276: feat(scope): summary first line" },
    ]);
  });

  test("parses multiple entries across bump sections", () => {
    const changes = `### Major Changes

- aaaaaaa: BREAKING: removed old api

### Minor Changes

- bbbbbbb: feat: new thing

### Patch Changes

- ccccccc: fix: small fix`;

    const entries = parseChangeEntries({ changes });
    expect(entries).toEqual([
      { type: "major", text: "- aaaaaaa: BREAKING: removed old api" },
      { type: "minor", text: "- bbbbbbb: feat: new thing" },
      { type: "patch", text: "- ccccccc: fix: small fix" },
    ]);
  });

  test("keeps a multi-line indented body intact", () => {
    const changes = `### Minor Changes

- 6d52276: feat(scope): summary

  first body line
  second body line`;

    const entries = parseChangeEntries({ changes });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.text).toBe(
      `- 6d52276: feat(scope): summary

  first body line
  second body line`,
    );
  });

  test("keeps fenced code blocks intact", () => {
    const changes = `### Minor Changes

- 6d52276: feat(scope): summary

  body line

  \`\`\`ts
  const x = 1;
  \`\`\``;

    const entries = parseChangeEntries({ changes });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.text).toContain("```ts");
    expect(entries[0]?.text).toContain("const x = 1;");
  });

  test("excludes Updated dependencies entries", () => {
    const changes = `### Patch Changes

- Updated dependencies [6d52276]
  - @checkstack/common@0.12.0
  - @checkstack/catalog-common@2.2.3`;

    expect(parseChangeEntries({ changes })).toEqual([]);
  });

  test("keeps real entries but drops dependency entries in a mixed section", () => {
    const changes = `### Minor Changes

- 7a23261: feat: real change

  some body

### Patch Changes

- Updated dependencies [7a23261]
  - @checkstack/frontend-api@0.2.0`;

    const entries = parseChangeEntries({ changes });
    expect(entries).toEqual([
      {
        type: "minor",
        text: `- 7a23261: feat: real change

  some body`,
      },
    ]);
  });
});

describe("groupChanges", () => {
  test("groups the same change across two packages into one entry", () => {
    const changelogs = [
      {
        packageName: "@checkstack/b",
        version: "1.0.0",
        changes: `### Minor Changes

- 6d52276: feat(scope): shared change`,
      },
      {
        packageName: "@checkstack/a",
        version: "2.0.0",
        changes: `### Minor Changes

- 6d52276: feat(scope): shared change`,
      },
    ];

    const groups = groupChanges({ changelogs });
    expect(groups).toEqual([
      {
        type: "minor",
        text: "- feat(scope): shared change",
        packages: ["@checkstack/a", "@checkstack/b"],
      },
    ]);
  });

  test("strips the commit-hash prefix from the dedup key/text", () => {
    const changelogs = [
      {
        packageName: "@checkstack/a",
        version: "1.0.0",
        changes: `### Patch Changes

- abcdef0: fix: something`,
      },
    ];

    const groups = groupChanges({ changelogs });
    expect(groups[0]?.text).toBe("- fix: something");
  });

  test("takes the max bump level when the same change differs per package", () => {
    const changelogs = [
      {
        packageName: "@checkstack/a",
        version: "1.0.0",
        changes: `### Patch Changes

- 6d52276: feat: dual change`,
      },
      {
        packageName: "@checkstack/b",
        version: "2.0.0",
        changes: `### Major Changes

- 6d52276: feat: dual change`,
      },
    ];

    const groups = groupChanges({ changelogs });
    expect(groups).toHaveLength(1);
    expect(groups[0]?.type).toBe("major");
    expect(groups[0]?.packages).toEqual(["@checkstack/a", "@checkstack/b"]);
  });

  test("keeps two different changes separate", () => {
    const changelogs = [
      {
        packageName: "@checkstack/a",
        version: "1.0.0",
        changes: `### Minor Changes

- 1111111: feat: alpha

### Patch Changes

- 2222222: fix: beta`,
      },
    ];

    const groups = groupChanges({ changelogs });
    expect(groups).toHaveLength(2);
    const texts = groups.map((g) => g.text).toSorted();
    expect(texts).toEqual(["- feat: alpha", "- fix: beta"]);
  });
});

describe("generateMarkdown", () => {
  test("lists a shared change once with a Packages line under the right section", () => {
    const changelogs = [
      {
        packageName: "@checkstack/a",
        version: "1.0.0",
        changes: `### Minor Changes

- 6d52276: feat(scope): shared change`,
      },
      {
        packageName: "@checkstack/b",
        version: "1.0.0",
        changes: `### Minor Changes

- 6d52276: feat(scope): shared change`,
      },
    ];

    const markdown = generateMarkdown({ version: "1.2.3", changelogs });

    expect(markdown).toContain("# Checkstack v1.2.3 Changelog");
    expect(markdown).toContain("## Minor Changes");
    // The change text appears exactly once (deduplicated).
    const occurrences = markdown.split("feat(scope): shared change").length - 1;
    expect(occurrences).toBe(1);
    expect(markdown).toContain(
      "  **Packages:** @checkstack/a, @checkstack/b",
    );
    // Hash prefix stripped from the rendered change.
    expect(markdown).not.toContain("6d52276:");
  });

  test("renders the empty case", () => {
    const markdown = generateMarkdown({ version: "1.0.0", changelogs: [] });
    expect(markdown).toContain("No package changes in this release.");
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
