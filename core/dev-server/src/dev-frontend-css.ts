/**
 * Tailwind content-glob assembly for the standalone dev server's inline
 * Vite/PostCSS pipeline.
 *
 * The dev server roots Vite at the installed `@checkstack/frontend`
 * directory and applies the shared `@checkstack/frontend/tailwind-preset`
 * (theme + `tailwindcss-animate`). The preset carries NO `content`, so we
 * supply an explicit, ABSOLUTE content-glob set here. The load-bearing
 * part is that it reaches the plugin under development's OWN source tree —
 * otherwise a plugin author's custom Tailwind utility classes (anything
 * outside the precompiled `@checkstack/ui` components) never compile into
 * the dev CSS. We also cover the dev shell and any extra source dirs (e.g.
 * the shared UI library) so their classes generate too.
 *
 * Pure: takes only resolved directory inputs and returns globs. No FS, no
 * Tailwind, no Vite — so the unit suite can assert the glob shape without
 * touching disk.
 */
import path from "node:path";

export interface DevTailwindContentInput {
  /** Installed `@checkstack/frontend` root (Vite `root`). */
  frontendDir: string;
  /** The plugin author's package directory (the dev `cwd`). */
  pluginCwd: string;
  /**
   * Absolute path to the plugin's resolved frontend entry file (from
   * `pickFrontendEntry`). Its package directory is scanned so the author's
   * classes are picked up even when the entry lives in a `-frontend`
   * sibling rather than `pluginCwd` itself.
   */
  pluginEntry: string;
  /**
   * Resolved `src` directories of additional frontend packages whose
   * components the dev shell renders (e.g. `@checkstack/ui`). Best-effort:
   * callers pass whatever resolved cleanly; missing ones are omitted.
   */
  extraSourceDirs?: string[];
}

const SOURCE_GLOB = "**/*.{js,ts,jsx,tsx}";

/**
 * Build the absolute Tailwind `content` glob list for the dev pipeline.
 * De-duplicated; order is dev-shell first, then extras, then the plugin's
 * own sources (which are the whole point of this function).
 */
export function buildDevTailwindContent({
  frontendDir,
  pluginCwd,
  pluginEntry,
  extraSourceDirs = [],
}: DevTailwindContentInput): string[] {
  const globs: string[] = [
    // Dev shell.
    path.join(frontendDir, "index.html"),
    path.join(frontendDir, "src", SOURCE_GLOB),
    // Extra source dirs (e.g. @checkstack/ui).
    ...extraSourceDirs.map((dir) => path.join(dir, SOURCE_GLOB)),
    // The plugin's own sources — the load-bearing part. Cover the directory
    // the entry file lives in (the `-frontend` package, possibly a sibling:
    // e.g. `packages/widget-frontend/src/index.tsx` → scan that whole `src`
    // tree) and the dev `cwd`'s own `src` (they differ for a bundle
    // primary, and we want the author's classes whichever one holds the
    // components).
    path.join(path.dirname(pluginEntry), SOURCE_GLOB),
    path.join(pluginCwd, "src", SOURCE_GLOB),
  ];

  // De-dupe while preserving order.
  return [...new Set(globs)];
}
