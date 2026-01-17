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
 * Determine the change type category for a changelog entry
 */
function getChangeType(changes: string): "major" | "minor" | "patch" {
  if (changes.includes("### Major Changes")) {
    return "major";
  }
  if (changes.includes("### Minor Changes")) {
    return "minor";
  }
  return "patch";
}

/**
 * Generate markdown output from aggregated changelogs
 */
function generateMarkdown(
  version: string,
  changelogs: PackageChangelog[],
): string {
  const lines: string[] = [`# Checkstack v${version} Changelog`, ""];

  if (changelogs.length === 0) {
    lines.push("No package changes in this release.");
    return lines.join("\n");
  }

  // Group by change type
  const majorChanges = changelogs.filter(
    (c) => getChangeType(c.changes) === "major",
  );
  const minorChanges = changelogs.filter(
    (c) => getChangeType(c.changes) === "minor",
  );
  const patchChanges = changelogs.filter(
    (c) => getChangeType(c.changes) === "patch",
  );

  if (majorChanges.length > 0) {
    lines.push(
      "## Breaking Changes",
      "",
      ...majorChanges.flatMap((changelog) => [
        `### ${changelog.packageName}@${changelog.version}`,
        "",
        normalizeHeadings(changelog.changes),
        "",
      ]),
    );
  }

  if (minorChanges.length > 0) {
    lines.push(
      "## Minor Changes",
      "",
      ...minorChanges.flatMap((changelog) => [
        `### ${changelog.packageName}@${changelog.version}`,
        "",
        normalizeHeadings(changelog.changes),
        "",
      ]),
    );
  }

  if (patchChanges.length > 0) {
    lines.push(
      "## Patch Changes",
      "",
      ...patchChanges.flatMap((changelog) => [
        `### ${changelog.packageName}@${changelog.version}`,
        "",
        normalizeHeadings(changelog.changes),
        "",
      ]),
    );
  }

  return lines.join("\n");
}

/**
 * Truncate the markdown output to fit within GitHub's character limit.
 * Truncates at package boundaries (### headers) to avoid cutting mid-content.
 */
function truncateToLimit(markdown: string): string {
  if (markdown.length <= MAX_BODY_LENGTH) {
    return markdown;
  }

  const reservedLength = TRUNCATION_NOTICE.length;
  const targetLength = MAX_BODY_LENGTH - reservedLength;

  // Find a safe truncation point at a package boundary (### header)
  // We look backwards from the target length to find the last complete package section
  const lines = markdown.split("\n");
  let currentLength = 0;
  let lastPackageBoundaryIndex = 0;

  for (const [index, line] of lines.entries()) {
    const lineLength = line.length + 1; // +1 for newline

    // Check if this is a package boundary (### header)
    if (line.startsWith("### ")) {
      if (currentLength + lineLength > targetLength) {
        // This package section would exceed the limit, stop before it
        break;
      }
      lastPackageBoundaryIndex = index;
    }

    currentLength += lineLength;

    if (currentLength > targetLength && lastPackageBoundaryIndex > 0) {
      // We've exceeded the limit, truncate at the last safe boundary
      break;
    }
  }

  // If we found a safe boundary, truncate there
  if (lastPackageBoundaryIndex > 0) {
    const truncatedLines = lines.slice(0, lastPackageBoundaryIndex);
    return truncatedLines.join("\n") + TRUNCATION_NOTICE;
  }

  // Fallback: hard truncate if no safe boundary found
  return markdown.slice(0, targetLength) + TRUNCATION_NOTICE;
}

async function main() {
  const version = await getReleaseVersion();
  console.error(`Aggregating changelogs for Checkstack v${version}`);

  const changelogs = await aggregateChangelogs();
  console.error(`Found ${changelogs.length} packages with changes`);

  const markdown = generateMarkdown(version, changelogs);
  const output = truncateToLimit(markdown);

  if (output.length < markdown.length) {
    console.error(
      `⚠️ Output truncated from ${markdown.length} to ${output.length} characters`,
    );
  }

  console.log(output);
}

await main();
