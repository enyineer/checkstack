import fs from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";

/**
 * Emit `public.html` as a copy of the built `index.html`.
 *
 * The custom-domain public bundle is served by the backend from a SEPARATE
 * `public.html` file (`core/backend/src/index.ts`: a verified custom-domain host
 * serves `public.html`, never the admin `index.html`, and 404s when it is
 * missing - "fail safe rather than leak the admin shell"). There is a SINGLE
 * html/JS entry (`main.tsx`) that branches to the lean `PublicApp` at runtime
 * from the `publicHost` the backend inlines into the served HTML, so
 * `public.html` is byte-identical to `index.html`; it only has to EXIST so the
 * custom-domain SPA fallback serves the bundle instead of 404ing.
 *
 * The build never emitted it (the file was assumed by the custom-domains feature
 * in #341 but no build step produced it), so custom domains 404'd on every
 * navigational route. This plugin closes that gap; `copyIndexToPublic` is the
 * pure step, exported for a unit regression guard.
 */
export function copyIndexToPublic(dir: string): boolean {
  const indexPath = path.join(dir, "index.html");
  if (!fs.existsSync(indexPath)) return false;
  fs.copyFileSync(indexPath, path.join(dir, "public.html"));
  return true;
}

export function emitPublicHtml({ fallbackDir }: { fallbackDir: string }): Plugin {
  return {
    name: "checkstack:emit-public-html",
    // writeBundle runs AFTER index.html (with its hashed asset refs) is written,
    // so the copy carries the exact same bundle entry.
    writeBundle(options) {
      copyIndexToPublic(options.dir ?? fallbackDir);
    },
  };
}
