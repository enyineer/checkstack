/**
 * Prune the workspace to only the packages the SATELLITE image needs, run in
 * the satellite Docker build (see `Dockerfile.satellite`).
 *
 * Unlike a static name-pattern prune, this keeps the transitive runtime-
 * dependency closure of the satellite AND of every plugin it loads dynamically
 * (`healthcheck-*-backend` / `collector-*-backend`), so neither a static
 * satellite dependency (e.g. a telemetry contract) nor a shared plugin contract
 * a backend depends on can be deleted by accident - both of which surface only
 * as an `ENOENT` crash loop at runtime, never at build time.
 *
 * The closure logic lives in (and is unit-tested via) `satellite-prune.logic.ts`;
 * this file is just the filesystem shell: discover packages, compute the remove
 * set, sanity-check it, and delete.
 */
import { rm } from "node:fs/promises";
import path from "node:path";

import {
  computeSatellitePrune,
  type PrunePackage,
} from "./satellite-prune.logic";
import {
  discoverWorkspacePackages,
  checkstackWorkspaceDeps,
} from "./workspace-packages";

const ROOT = process.cwd();
const SATELLITE_NAME = "@checkstack/satellite";

async function main() {
  // RUNTIME deps only - devDeps are already gone under `--production`, and a
  // package needed only at build time is not needed in the image.
  const discovered = await discoverWorkspacePackages(ROOT);
  const packages: PrunePackage[] = discovered.map((p) => ({
    name: p.name,
    relDir: p.relDir,
    deps: checkstackWorkspaceDeps(p, { includeDev: false }),
  }));
  if (!packages.some((p) => p.name === SATELLITE_NAME)) {
    throw new Error(
      `prune-for-satellite: ${SATELLITE_NAME} not found among workspace packages - refusing to prune.`,
    );
  }

  const { keep, removeDirs } = computeSatellitePrune({
    packages,
    satelliteName: SATELLITE_NAME,
  });

  // Safety guard: a bug that collapsed the keep-set would otherwise wipe the
  // image. The satellite's own closure is always more than a handful of
  // packages, so treat a tiny keep-set as a computation failure, not a prune.
  if (keep.size < 5) {
    throw new Error(
      `prune-for-satellite: keep-set is suspiciously small (${keep.size}) - refusing to prune.`,
    );
  }

  for (const relDir of removeDirs) {
    await rm(path.join(ROOT, relDir), { recursive: true, force: true });
  }

  console.log(
    `prune-for-satellite: kept ${keep.size} packages, removed ${removeDirs.length} package dirs.`,
  );
}

await main();
