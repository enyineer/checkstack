import type { Monaco } from "@monaco-editor/react";

/**
 * Lazy-load the bundled `@types/node` + `bun-types` declarations and mount
 * them into a Monaco TypeScript service.
 *
 * The bundle lives at [generated/stdlib-types.json](./generated/stdlib-types.json)
 * and is produced by `bun run generate:monaco-types`. It's ~3 MB of upstream
 * `.d.ts` content, which is why we **dynamically import** it: bundlers
 * (Vite, Rspack, …) split the JSON into its own chunk so it never blocks the
 * initial frontend load. The chunk is fetched the first time the user opens
 * an inline-script editor and cached for the rest of the session.
 *
 * Each file is registered at its real `node_modules/...` virtual path, so
 * Monaco resolves cross-file `/// <reference>` directives just like the
 * canonical TypeScript service would on disk.
 */

type StdlibBundle = Record<string, string>;

let bundlePromise: Promise<StdlibBundle> | undefined;

function loadBundle(): Promise<StdlibBundle> {
  if (!bundlePromise) {
    bundlePromise = import("./generated/stdlib-types.json").then(
      (mod) => mod.default as StdlibBundle,
    );
  }
  return bundlePromise;
}

const installedFor = new WeakSet<object>();

/**
 * Register the bundled stdlib types with the given Monaco instance.
 *
 * Safe to call multiple times — the work is gated on a per-Monaco
 * `WeakSet` so we only `addExtraLib` once per instance, even across many
 * editor mounts.
 *
 * @returns true once the stdlib is installed (or was already).
 */
export async function ensureMonacoStdlib(monaco: Monaco): Promise<boolean> {
  if (installedFor.has(monaco)) return true;

  const bundle = await loadBundle();

  // TypeScript and JavaScript share a single TS service in Monaco, but each
  // service tracks its own extra-libs. Register against both so the same
  // bundle covers either language mode.
  for (const defaults of [
    monaco.languages.typescript.typescriptDefaults,
    monaco.languages.typescript.javascriptDefaults,
  ]) {
    for (const [path, content] of Object.entries(bundle)) {
      defaults.addExtraLib(content, `file:///${path}`);
    }
  }

  installedFor.add(monaco);
  return true;
}
