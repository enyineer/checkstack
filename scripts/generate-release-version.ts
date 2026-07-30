#!/usr/bin/env bun
/**
 * Generates the build-time PLATFORM RELEASE version constant surfaced on the
 * About page.
 *
 * ## Why this exists
 *
 * Two different version numbers are both real, and users conflate them:
 *
 * - `@checkstack/backend`'s package version, which the About page has always
 *   shown. It only moves when that package changes.
 * - `@checkstack/release`'s version, which IS the GitHub release tag, the Docker
 *   image tag, and the number in every release announcement. `inject-release.ts`
 *   forces it into every changeset, so it moves on every release.
 *
 * So a user reading "v0.25.6" on the About page has no way to connect it to the
 * "v0.136.0" release they installed. This generator makes the release number
 * available to the running app so both can be shown, correctly labelled.
 *
 * ## Why generated rather than read at runtime
 *
 * `@checkstack/release` is `private: true` - it is never published, so it is
 * absent from `node_modules` in an npm-installed deployment. Reading its
 * `package.json` by relative path works in the monorepo and in the Docker image
 * and silently fails everywhere else. A generated constant is correct in all
 * three.
 *
 * Emits (committed):
 *   core/backend/src/generated/release-version.ts
 *
 * Modes:
 *   - default: write the generated file to disk.
 *   - --check: regenerate in memory and diff against the committed file; exit 1
 *     on drift. Run in CI, mirroring `generate:docs-index:check`.
 *
 * Runs AFTER `changeset version` in the `version-packages` script, so it picks
 * up the freshly-bumped release version.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const RELEASE_PACKAGE_JSON = path.join(ROOT, "core", "release", "package.json");
const OUTPUT_FILE = path.join(
  ROOT,
  "core",
  "backend",
  "src",
  "generated",
  "release-version.ts",
);

const CHECK_ONLY = process.argv.includes("--check");

/** Reads the platform release version from `@checkstack/release`. */
export function readReleaseVersion({ packageJsonPath }: { packageJsonPath: string }): string {
  const raw = readFileSync(packageJsonPath, "utf8");
  const parsed: unknown = JSON.parse(raw);

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("version" in parsed) ||
    typeof parsed.version !== "string" ||
    parsed.version.length === 0
  ) {
    throw new Error(
      `${packageJsonPath} has no usable "version" field; cannot generate the release constant.`,
    );
  }

  return parsed.version;
}

/** Renders the generated module. Kept trivial so the diff is easy to review. */
export function renderReleaseVersionModule({
  version,
}: {
  version: string;
}): string {
  return `// GENERATED FILE - DO NOT EDIT.
// Run \`bun run generate:release-version\` to regenerate.
//
// The platform release version: the GitHub release tag, the Docker image tag,
// and the number users see in release announcements. Sourced from
// \`core/release/package.json\`, which \`scripts/inject-release.ts\` bumps on
// every release.
//
// This is NOT the same as \`@checkstack/backend\`'s own package version, which
// only moves when that package changes. The About page shows both.

export const RELEASE_VERSION = ${JSON.stringify(version)};
`;
}

function main(): void {
  if (!existsSync(RELEASE_PACKAGE_JSON)) {
    console.error(`❌ Release package not found: ${RELEASE_PACKAGE_JSON}`);
    process.exit(1);
  }

  const version = readReleaseVersion({ packageJsonPath: RELEASE_PACKAGE_JSON });
  const content = renderReleaseVersionModule({ version });

  if (CHECK_ONLY) {
    const previous = existsSync(OUTPUT_FILE)
      ? readFileSync(OUTPUT_FILE, "utf8")
      : undefined;
    if (previous !== content) {
      console.error(
        "❌ The generated release version is out of sync with core/release/package.json:",
      );
      console.error(`   - ${path.relative(ROOT, OUTPUT_FILE)}`);
      console.error(
        "\nRun `bun run generate:release-version` and commit the change.",
      );
      process.exit(1);
    }
    console.log("✓ Generated release version is up to date.");
    return;
  }

  mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
  writeFileSync(OUTPUT_FILE, content, "utf8");
  console.log(
    `✓ Generated release version ${version} (${path.relative(ROOT, OUTPUT_FILE)}).`,
  );
}

if (import.meta.main) {
  main();
}
