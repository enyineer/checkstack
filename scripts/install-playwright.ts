#!/usr/bin/env bun
/**
 * Install Playwright browsers pinned to the EXACT version resolved in bun.lock.
 *
 * Why this exists: `@playwright/test`/`playwright` are nested under the
 * workspace packages, not the repo-root node_modules, so a bare
 * `bunx playwright install` at the root finds no local binary and downloads
 * `playwright@latest` from npm. The moment npm's latest drifts past the locked
 * version it installs a DIFFERENT browser build, and the tests' locked
 * `@playwright/test` then can't find their expected binary
 * (`chromium_headless_shell-<n>`). Pinning the install to the lockfile version
 * makes it deterministic and immune to new Playwright releases. We also install
 * `chromium-headless-shell` by default because recent Playwright ships the
 * binary `chromium.launch()` uses as a SEPARATE component from `chromium`.
 *
 * Usage:
 *   bun run scripts/install-playwright.ts                       # chromium + headless shell
 *   bun run scripts/install-playwright.ts --with-deps           # + OS deps (CI/Linux)
 *   bun run scripts/install-playwright.ts firefox webkit        # explicit browser set
 *
 * Any non-flag argument is treated as a browser name and overrides the default
 * set. `--with-deps` is forwarded to `playwright install`.
 */

import { $ } from "bun";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const LOCKFILE_PATH = path.join(ROOT, "bun.lock");
const DEFAULT_BROWSERS = ["chromium", "chromium-headless-shell"];

/**
 * Extract the single resolved `playwright` version from a bun text lockfile.
 * bun.lock entries look like `"playwright": ["playwright@1.60.0", ...]`; we
 * match the leaf package (not `playwright-core` / `@playwright/test`). Throws
 * if absent, or if the graph resolved more than one distinct version (which a
 * pinned install could not represent unambiguously).
 */
export function resolvePlaywrightVersion({
  lockfileText,
}: {
  lockfileText: string;
}): string {
  const versions = new Set<string>();
  for (const match of lockfileText.matchAll(/"playwright@(\d[^"]*)"/g)) {
    const version = match[1];
    if (version) versions.add(version);
  }
  if (versions.size === 0) {
    throw new Error("Could not find a resolved `playwright` version in bun.lock");
  }
  if (versions.size > 1) {
    throw new Error(
      `bun.lock resolved multiple playwright versions (${[...versions].join(", ")}); align them before pinning the browser install`,
    );
  }
  return [...versions][0]!;
}

function parseArgs({ argv }: { argv: string[] }): {
  browsers: string[];
  withDeps: boolean;
} {
  const withDeps = argv.includes("--with-deps");
  const browsers = argv.filter((a) => !a.startsWith("--"));
  return {
    browsers: browsers.length > 0 ? browsers : DEFAULT_BROWSERS,
    withDeps,
  };
}

if (import.meta.main) {
  const version = resolvePlaywrightVersion({
    lockfileText: readFileSync(LOCKFILE_PATH, "utf8"),
  });
  const { browsers, withDeps } = parseArgs({ argv: process.argv.slice(2) });

  console.log(
    `Installing Playwright browsers for pinned version ${version}: ${browsers.join(", ")}${withDeps ? " (--with-deps)" : ""}`,
  );

  const args = [
    `playwright@${version}`,
    "install",
    ...(withDeps ? ["--with-deps"] : []),
    ...browsers,
  ];
  await $`bunx ${args}`;
}
