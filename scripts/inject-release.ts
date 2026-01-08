/**
 * Preversion hook for Changesets
 *
 * This script runs before `changeset version` and ensures that
 * @checkmate-monitor/release is always included in pending changesets.
 * This keeps the Docker image version in sync with any package changes.
 */

import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const CHANGESET_DIR = path.join(import.meta.dirname, "..", ".changeset");
const RELEASE_PACKAGE = "@checkmate-monitor/release";

type BumpType = "major" | "minor" | "patch";

interface ChangesetData {
  packages: Array<{ name: string; type: BumpType }>;
  summary: string;
}

function parseFrontmatter(content: string): ChangesetData {
  const lines = content.split("\n");
  const packages: Array<{ name: string; type: BumpType }> = [];
  let inFrontmatter = false;
  let summaryStartIndex = 0;

  for (const [i, line] of lines.entries()) {
    if (line.trim() === "---") {
      if (inFrontmatter) {
        summaryStartIndex = i + 1;
        break;
      } else {
        inFrontmatter = true;
      }
      continue;
    }

    if (inFrontmatter) {
      // Parse package entries like: "@checkmate-monitor/backend": minor
      const match = line.match(/^["']?([^"':]+)["']?:\s*(major|minor|patch)$/);
      if (match) {
        packages.push({ name: match[1], type: match[2] as BumpType });
      }
    }
  }

  const summary = lines.slice(summaryStartIndex).join("\n").trim();
  return { packages, summary };
}

function serializeChangeset(data: ChangesetData): string {
  const frontmatter = data.packages
    .map((p) => `"${p.name}": ${p.type}`)
    .join("\n");

  return `---\n${frontmatter}\n---\n\n${data.summary}\n`;
}

function getHighestBumpType(types: BumpType[]): BumpType {
  if (types.includes("major")) return "major";
  if (types.includes("minor")) return "minor";
  return "patch";
}

async function main() {
  const entries = await readdir(CHANGESET_DIR, { withFileTypes: true });

  const changesetFiles = entries
    .filter(
      (e) => e.isFile() && e.name.endsWith(".md") && e.name !== "README.md"
    )
    .map((e) => e.name);

  if (changesetFiles.length === 0) {
    console.log("No pending changesets found.");
    return;
  }

  console.log(`Found ${changesetFiles.length} pending changeset(s).`);

  let highestBumpType: BumpType = "patch";
  let releaseAlreadyIncluded = false;
  let firstChangesetWithoutRelease: string | undefined;

  // First pass: find highest bump type and check if release is already included
  for (const file of changesetFiles) {
    const content = await readFile(path.join(CHANGESET_DIR, file), "utf8");
    const data = parseFrontmatter(content);

    for (const pkg of data.packages) {
      if (pkg.name === RELEASE_PACKAGE) {
        releaseAlreadyIncluded = true;
      }
      highestBumpType = getHighestBumpType([highestBumpType, pkg.type]);
    }

    if (
      !releaseAlreadyIncluded &&
      !firstChangesetWithoutRelease &&
      data.packages.length > 0
    ) {
      firstChangesetWithoutRelease = file;
    }
  }

  if (releaseAlreadyIncluded) {
    console.log(`${RELEASE_PACKAGE} is already included in a changeset.`);
    return;
  }

  if (!firstChangesetWithoutRelease) {
    console.log("No valid changesets to modify.");
    return;
  }

  // Inject release package into the first changeset
  const filePath = path.join(CHANGESET_DIR, firstChangesetWithoutRelease);
  const content = await readFile(filePath, "utf8");
  const data = parseFrontmatter(content);

  data.packages.push({ name: RELEASE_PACKAGE, type: highestBumpType });

  await writeFile(filePath, serializeChangeset(data));

  console.log(
    `Injected ${RELEASE_PACKAGE} (${highestBumpType}) into ${firstChangesetWithoutRelease}`
  );
}

await main();
