#!/usr/bin/env bun
/**
 * `predev` bootstrap: make sure `node_modules` exists so the developer cockpit
 * (an @opentui/react TUI) can even launch - a fresh clone has none, and a TUI
 * cannot render a "please install" prompt if its own renderer isn't installed.
 *
 * It ONLY installs when `node_modules` is absent. The normal case - syncing to a
 * just-pulled Renovate lock-file change - is handled with streamed progress
 * INSIDE the cockpit (see core/scripts/src/cockpit/install-deps.ts), so this
 * stays a no-op on every launch after the first.
 *
 * Written as a bun script rather than a shell `test -d ... || ...` so it behaves
 * identically on Windows, Linux, and macOS. `process.execPath` is the very bun
 * binary running this script, so the install spawn needs no PATH/`.exe`/`.cmd`
 * resolution.
 */
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

/** Pure decision, so it is trivially testable without touching the filesystem. */
export function needsBootstrap({ exists }: { exists: (path: string) => boolean }): boolean {
  return !exists("node_modules");
}

if (import.meta.main && needsBootstrap({ exists: existsSync })) {
  console.log("node_modules missing - bootstrapping (bun install --frozen-lockfile)...");
  const { status } = spawnSync(process.execPath, ["install", "--frozen-lockfile"], {
    stdio: "inherit",
  });
  if (status !== 0) process.exit(status ?? 1);
}
