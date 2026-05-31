/**
 * Aggregate Changelog Script
 *
 * Generates unified release notes by extracting the current version's
 * changelog entries from all packages and aggregating them into a single document.
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const ROOT_DIR = path.join(import.meta.dirname, "..");

/**
 * GitHub API limit for release body is 65536 characters.
 * We use a buffer to account for any additional content added by the workflow.
 */
const MAX_BODY_LENGTH = 60_000;
const TRUNCATION_NOTICE = `

---

> ⚠️ **Release notes truncated** due to GitHub's character limit.
> See individual package \`CHANGELOG.md\` files for complete details.
`;
const RELEASE_PACKAGE_PATH = path.join(ROOT_DIR, "core", "release");
const PACKAGE_DIRS = [
  path.join(ROOT_DIR, "core"),
  path.join(ROOT_DIR, "plugins"),
];

interface PackageChangelog {
  packageName: string;
  version: string;
  changes: string;
}

type BumpType = "major" | "minor" | "patch";

/**
 * A single changelog entry parsed out of a package's version-changelog,
 * tagged with the bump section it appeared under.
 */
interface ChangeEntry {
  type: BumpType;
  text: string;
}

/**
 * A deduplicated change, grouped across every package the same changeset
 * touched. `text` is the hash-stripped entry, `packages` is the sorted
 * unique list of package names, and `type` is the highest bump across them.
 */
interface GroupedChange {
  type: BumpType;
  text: string;
  packages: string[];
}

const BUMP_RANK: Record<BumpType, number> = {
  patch: 0,
  minor: 1,
  major: 2,
};

/**
 * Pick the higher-severity bump of two (major > minor > patch).
 */
function maxBumpType(a: BumpType, b: BumpType): BumpType {
  return BUMP_RANK[a] >= BUMP_RANK[b] ? a : b;
}

/**
 * Deterministic sort comparator for grouped changes (by their text).
 */
function compareChangeText(a: GroupedChange, b: GroupedChange): number {
  return a.text.localeCompare(b.text);
}

/**
 * A safe truncation boundary: the start of a top-level change (`- ` at
 * column 0) or a `## ` section header.
 */
function isTruncationBoundary(line: string): boolean {
  return line.startsWith("## ") || line.startsWith("- ");
}

/**
 * Increase all markdown heading levels by a specified amount.
 * This prevents embedded headings from conflicting with our document structure.
 * Also strips the "Major Changes", "Minor Changes", "Patch Changes" sub-headers
 * since we already group by these at the top level.
 */
function normalizeHeadings(content: string): string {
  const lines = content.split("\n");
  const result: string[] = [];

  for (const line of lines) {
    // Skip the change type headers - we already group by these
    if (
      line.trim() === "### Major Changes" ||
      line.trim() === "### Minor Changes" ||
      line.trim() === "### Patch Changes"
    ) {
      continue;
    }

    // Handle changeset entries that start with a heading (e.g., "- 8e43507: # Some heading")
    // Strip the heading markers from these lines
    const changesetHeadingMatch = /^(- [a-f0-9]+: )#+\s+(.*)$/.exec(line);
    if (changesetHeadingMatch) {
      const [, prefix, text] = changesetHeadingMatch;
      result.push(`${prefix}**${text}**`);
      continue;
    }

    // Handle actual markdown headings (optionally indented, but not list items with # in text)
    // A proper heading line has: optional whitespace, then # characters, then space, then text
    // We should NOT match lines like "- 8e43507: # Some heading" because that's text content
    const trimmed = line.trimStart();
    if (trimmed.startsWith("#") && !line.trimStart().startsWith("-")) {
      const headingMatch = /^(\s*)(#+)\s+(.*)$/.exec(line);
      if (headingMatch) {
        const [, indent, hashes, text] = headingMatch;
        // Increase heading levels by 4 to nest properly under our structure
        // Our structure: # Changelog > ## Breaking Changes > ### Package > #### content headings
        // Cap at 6 levels (markdown max)
        const newLevel = Math.min(hashes.length + 4, 6);
        result.push(`${indent}${"#".repeat(newLevel)} ${text}`);
        continue;
      }
    }

    result.push(line);
  }

  return result.join("\n").trim();
}

/**
 * Extract the changelog section for a specific version from a CHANGELOG.md file
 */
function extractVersionChangelog(
  content: string,
  version: string,
): string | undefined {
  const lines = content.split("\n");
  const versionHeader = `## ${version}`;

  let capturing = false;
  const capturedLines: string[] = [];

  for (const line of lines) {
    // Check if this is a version header
    if (line.startsWith("## ")) {
      if (capturing) {
        // We've reached the next version, stop capturing
        break;
      }
      if (line.trim() === versionHeader) {
        capturing = true;
      }
      continue;
    }

    if (capturing) {
      capturedLines.push(line);
    }
  }

  const result = capturedLines.join("\n").trim();
  return result || undefined;
}

/**
 * Check if a changelog entry only contains dependency updates
 * (i.e., no actual code changes in this package)
 *
 * These entries look like:
 * ```
 * ### Patch Changes
 *
 * - Updated dependencies [abc1234]
 *   - @checkstack/some-package@1.0.0
 * ```
 */
export function isDependencyOnlyChangelog(changes: string): boolean {
  const lines = changes.split("\n");

  // Find all TOP-LEVEL bullet point entries (lines starting with "- " without indentation)
  // Sub-bullets like "  - @checkstack/some-package@1.0.0" should not be counted
  const bulletLines = lines.filter((line) => line.startsWith("- "));

  if (bulletLines.length === 0) {
    // No bullet points at all - treat as dependency-only (empty changelog)
    return true;
  }

  // Check if every top-level bullet point is an "Updated dependencies" entry
  return bulletLines.every((line) => line.startsWith("- Updated dependencies"));
}

/**
 * Parse a package's version-changelog string into individual change entries.
 *
 * Tracks the current bump type from `### Major/Minor/Patch Changes` headers.
 * An entry starts at a top-level bullet (`- ` with no leading whitespace) and
 * includes every following line until the next top-level bullet, a `### `
 * header, a `## ` header, or end of input. Entries whose first line starts
 * with `- Updated dependencies` are excluded as per-package dependency noise.
 */
export function parseChangeEntries({
  changes,
}: {
  changes: string;
}): ChangeEntry[] {
  const lines = changes.split("\n");
  const entries: ChangeEntry[] = [];

  let currentType: BumpType = "patch";
  let currentLines: string[] | undefined;

  const flush = () => {
    if (!currentLines) {
      return;
    }
    const text = currentLines.join("\n").replace(/\s+$/, "");
    if (!text.startsWith("- Updated dependencies")) {
      entries.push({ type: currentType, text });
    }
    currentLines = undefined;
  };

  for (const line of lines) {
    if (line.startsWith("### ")) {
      flush();
      switch (line.trim()) {
        case "### Major Changes": {
          currentType = "major";
          break;
        }
        case "### Minor Changes": {
          currentType = "minor";
          break;
        }
        case "### Patch Changes": {
          currentType = "patch";
          break;
        }
      }
      continue;
    }

    if (line.startsWith("## ")) {
      // A version boundary should never appear inside an extracted
      // version-changelog, but guard against it defensively.
      flush();
      continue;
    }

    // A top-level bullet (no leading whitespace) starts a new entry.
    if (line.startsWith("- ")) {
      flush();
      currentLines = [line];
      continue;
    }

    // Continuation lines (indented body, blank lines, fenced code) belong to
    // the entry currently being accumulated.
    if (currentLines) {
      currentLines.push(line);
    }
  }

  flush();

  return entries;
}

/**
 * Normalize a change entry's first line into a dedup key by stripping the
 * leading commit-hash prefix (`- <hash>: ` → `- `) and trimming trailing
 * whitespace. Two entries from the same changeset share this normalized text.
 */
function normalizeChangeText(text: string): string {
  return text.replace(/^- [0-9a-f]{7,40}: /, "- ").replace(/\s+$/, "");
}

/**
 * Group change entries across all packages by their normalized (hash-stripped)
 * text. Each group records the deduplicated change text, the sorted unique
 * list of package names that contained it, and the highest bump type across
 * those packages.
 */
export function groupChanges({
  changelogs,
}: {
  changelogs: PackageChangelog[];
}): GroupedChange[] {
  const groups = new Map<
    string,
    { type: BumpType; text: string; packages: Set<string> }
  >();

  for (const changelog of changelogs) {
    const entries = parseChangeEntries({ changes: changelog.changes });

    for (const entry of entries) {
      const key = normalizeChangeText(entry.text);
      const existing = groups.get(key);

      if (existing) {
        existing.type = maxBumpType(existing.type, entry.type);
        existing.packages.add(changelog.packageName);
      } else {
        groups.set(key, {
          type: entry.type,
          text: key,
          packages: new Set([changelog.packageName]),
        });
      }
    }
  }

  return [...groups.values()].map((group) => ({
    type: group.type,
    text: group.text,
    packages: [...group.packages].toSorted((a, b) => a.localeCompare(b)),
  }));
}

/**
 * Recursively find all package directories with CHANGELOG.md files
 */
async function findPackagesWithChangelogs(
  baseDir: string,
): Promise<Array<{ dir: string; packageJson: { name: string } }>> {
  const packages: Array<{ dir: string; packageJson: { name: string } }> = [];

  try {
    const entries = await readdir(baseDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === "node_modules") continue;

      const packageDir = path.join(baseDir, entry.name);
      const packageJsonPath = path.join(packageDir, "package.json");
      const changelogPath = path.join(packageDir, "CHANGELOG.md");

      try {
        const [packageJsonContent] = await Promise.all([
          readFile(packageJsonPath, "utf8"),
          readFile(changelogPath, "utf8"), // Just check if it exists
        ]);

        const packageJson = JSON.parse(packageJsonContent) as {
          name?: string;
        };
        if (packageJson.name) {
          packages.push({
            dir: packageDir,
            packageJson: { name: packageJson.name },
          });
        }
      } catch {
        // Package doesn't have both package.json and CHANGELOG.md, skip
      }
    }
  } catch {
    // Directory doesn't exist, skip
  }

  return packages;
}

/**
 * Get the current release version from the @checkstack/release package
 */
async function getReleaseVersion(): Promise<string> {
  const packageJsonPath = path.join(RELEASE_PACKAGE_PATH, "package.json");
  const content = await readFile(packageJsonPath, "utf8");
  const packageJson = JSON.parse(content) as { version: string };
  return packageJson.version;
}

/**
 * Get the previous release version from the @checkstack/release changelog.
 * Returns undefined if this is the first release.
 */
export async function getPreviousReleaseVersion(
  currentVersion: string,
): Promise<string | undefined> {
  const changelogPath = path.join(RELEASE_PACKAGE_PATH, "CHANGELOG.md");
  const content = await readFile(changelogPath, "utf8");
  const lines = content.split("\n");

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

/**
 * Get a package's version at a specific git tag.
 * Returns undefined if the package didn't exist at that tag or git fails.
 */
async function getPackageVersionAtTag(
  packageDir: string,
  tag: string,
): Promise<string | undefined> {
  const relativePath = path.relative(
    ROOT_DIR,
    path.join(packageDir, "package.json"),
  );
  try {
    const result = await Bun.$`git show ${tag}:${relativePath}`.text();
    const packageJson = JSON.parse(result) as { version: string };
    return packageJson.version;
  } catch {
    // Package didn't exist at that tag or git command failed
    return undefined;
  }
}

/**
 * Aggregate changelogs from all packages for the given version
 */
async function aggregateChangelogs(): Promise<PackageChangelog[]> {
  const currentVersion = await getReleaseVersion();
  const previousVersion = await getPreviousReleaseVersion(currentVersion);
  const previousTag = previousVersion ? `v${previousVersion}` : undefined;

  const changelogs: PackageChangelog[] = [];

  for (const baseDir of PACKAGE_DIRS) {
    const packages = await findPackagesWithChangelogs(baseDir);

    for (const pkg of packages) {
      const changelogPath = path.join(pkg.dir, "CHANGELOG.md");

      try {
        const content = await readFile(changelogPath, "utf8");

        // Find the version for this package in the changelog
        // The version might be different from the release version
        const packageJsonContent = await readFile(
          path.join(pkg.dir, "package.json"),
          "utf8",
        );
        const packageJson = JSON.parse(packageJsonContent) as {
          version: string;
        };
        const packageVersion = packageJson.version;

        // Skip packages that weren't changed in this release
        // by comparing their current version to the version at the previous release tag
        if (previousTag) {
          const previousVersionAtTag = await getPackageVersionAtTag(
            pkg.dir,
            previousTag,
          );
          if (previousVersionAtTag === packageVersion) {
            // Package version hasn't changed since the previous release
            continue;
          }
        }

        const changes = extractVersionChangelog(content, packageVersion);

        if (changes && !isDependencyOnlyChangelog(changes)) {
          changelogs.push({
            packageName: pkg.packageJson.name,
            version: packageVersion,
            changes,
          });
        }
      } catch {
        // Skip if couldn't read changelog
      }
    }
  }

  // Sort by package name for consistent output
  return changelogs.toSorted((a, b) =>
    a.packageName.localeCompare(b.packageName),
  );
}

/**
 * Render a single grouped change as markdown: the (hash-stripped) change text
 * with any embedded headings normalized, followed by an indented sub-line
 * listing the affected packages so it stays inside the list item.
 */
function renderGroupedChange(change: GroupedChange): string[] {
  const packagesNote = `  **Packages:** ${change.packages.join(", ")}`;
  return [normalizeHeadings(change.text), "", packagesNote, ""];
}

/**
 * Generate markdown output from aggregated changelogs, deduplicating each
 * change so it appears once with the list of packages it touched.
 */
export function generateMarkdown({
  version,
  changelogs,
}: {
  version: string;
  changelogs: PackageChangelog[];
}): string {
  const lines: string[] = [`# Checkstack v${version} Changelog`, ""];

  if (changelogs.length === 0) {
    lines.push("No package changes in this release.");
    return lines.join("\n");
  }

  const grouped = groupChanges({ changelogs });

  const sections: Array<{ heading: string; type: BumpType }> = [
    { heading: "## Breaking Changes", type: "major" },
    { heading: "## Minor Changes", type: "minor" },
    { heading: "## Patch Changes", type: "patch" },
  ];

  for (const section of sections) {
    const sectionChanges = grouped
      .filter((change) => change.type === section.type)
      .toSorted(compareChangeText);

    if (sectionChanges.length === 0) {
      continue;
    }

    lines.push(
      section.heading,
      "",
      ...sectionChanges.flatMap((change) => renderGroupedChange(change)),
    );
  }

  return lines.join("\n");
}

/**
 * Truncate the markdown output to fit within GitHub's character limit.
 *
 * Truncates at safe boundaries — the start of a top-level change (`- ` at
 * column 0) or a `## ` section header — to avoid cutting mid-change or
 * mid-fenced-code.
 */
function truncateToLimit(markdown: string): string {
  if (markdown.length <= MAX_BODY_LENGTH) {
    return markdown;
  }

  const reservedLength = TRUNCATION_NOTICE.length;
  const targetLength = MAX_BODY_LENGTH - reservedLength;

  // Find a safe truncation point at a change boundary (top-level "- " bullet)
  // or a "## " section header. We walk forward and remember the last safe
  // boundary that still fits within the target length.
  const lines = markdown.split("\n");
  let currentLength = 0;
  let lastBoundaryIndex = 0;

  for (const [index, line] of lines.entries()) {
    const lineLength = line.length + 1; // +1 for newline

    if (isTruncationBoundary(line)) {
      if (currentLength + lineLength > targetLength) {
        // This change/section would exceed the limit, stop before it.
        break;
      }
      lastBoundaryIndex = index;
    }

    currentLength += lineLength;

    if (currentLength > targetLength && lastBoundaryIndex > 0) {
      // We've exceeded the limit, truncate at the last safe boundary.
      break;
    }
  }

  // If we found a safe boundary, truncate there.
  if (lastBoundaryIndex > 0) {
    const truncatedLines = lines.slice(0, lastBoundaryIndex);
    return truncatedLines.join("\n") + TRUNCATION_NOTICE;
  }

  // Fallback: hard truncate if no safe boundary found.
  return markdown.slice(0, targetLength) + TRUNCATION_NOTICE;
}

/**
 * Build the deduplicated release-notes markdown (untruncated).
 *
 * Aggregates every changed package's version-changelog and groups changes so
 * each one appears once with the packages it touched. Reused by both the
 * GitHub release body (truncated by `main`) and the Version Packages PR body
 * (`scripts/pr-release-notes.ts`, full form).
 */
export async function buildDeduplicatedReleaseNotes(): Promise<string> {
  const version = await getReleaseVersion();
  const changelogs = await aggregateChangelogs();
  return generateMarkdown({ version, changelogs });
}

async function main() {
  const version = await getReleaseVersion();
  console.error(`Aggregating changelogs for Checkstack v${version}`);

  const changelogs = await aggregateChangelogs();
  console.error(`Found ${changelogs.length} packages with changes`);

  const markdown = generateMarkdown({ version, changelogs });
  const output = truncateToLimit(markdown);

  if (output.length < markdown.length) {
    console.error(
      `⚠️ Output truncated from ${markdown.length} to ${output.length} characters`,
    );
  }

  console.log(output);
}

// Only run when invoked directly (not when imported as a module, e.g. by the
// test suite or `scripts/pr-release-notes.ts`). The workflow runs this file
// directly via `bun run scripts/aggregate-changelog.ts`, so the stdout
// contract is preserved.
if (import.meta.main) {
  await main();
}
