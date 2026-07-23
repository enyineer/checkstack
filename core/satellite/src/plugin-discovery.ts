/**
 * The SINGLE source of truth for which plugin directories the satellite loads
 * dynamically at runtime.
 *
 * This is consumed by BOTH:
 * - the runtime strategy loader (`strategy-loader.ts`), which scans `plugins/`
 *   and imports the matching plugins, and
 * - the build-time image prune (`scripts/satellite-prune.logic.ts`), which must
 *   keep exactly those plugins (as extra dependency-closure roots) so the image
 *   ships what the runtime will try to import.
 *
 * If these two ever disagreed - e.g. a new autodiscovered plugin category added
 * to the loader but not the prune - the prune would delete a plugin the runtime
 * needs and the agent would crash-loop with `ENOENT` at startup. Keeping the
 * rule here, imported by both, makes that impossible.
 */

/**
 * Whether a `plugins/<name>` directory basename is a plugin the satellite loads
 * dynamically: a health-check strategy backend or a standalone collector
 * backend.
 */
export function isSatelliteLoadedPluginDir(dirName: string): boolean {
  return (
    (dirName.startsWith("healthcheck-") && dirName.endsWith("-backend")) ||
    (dirName.startsWith("collector-") && dirName.endsWith("-backend"))
  );
}
