import { Readable } from "node:stream";
import {
  installPackageMetadataSchema,
  pluginBundleManifestSchema,
  type InstallPackageMetadata,
  type PluginBundleManifest,
} from "@checkstack/common";

// `tar` 7.x eagerly destructures `O_CREAT` from `fs.constants` at module
// evaluation time. When Bun's test runner mocks other node modules first
// (via `mock.module(...)` in test-preload), the fs.constants lookup can
// race that mock chain and yield `null`, producing
// "Cannot destructure property 'O_CREAT' from null or undefined value".
//
// Importing tar lazily (only when readTarEntries is actually invoked)
// pushes the destructure past the mock-chain settle point, so the lib
// loads cleanly. In production this adds one async resolve on first use.
async function getTarParser(): Promise<typeof import("tar").Parser> {
  const mod = await import("tar");
  return mod.Parser;
}

/**
 * Maximum size we'll accept for a plugin (or bundle) tarball.
 * Mirrors `PluginArtifactStore.maxArtifactSize` — the artifact store
 * authoritatively enforces; this is a quick rejection before bytes hit DB.
 */
export const MAX_TARBALL_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB

const TAR_PREFIX = "package/"; // npm pack always wraps content in `package/`

/**
 * Read all entries from a tarball into memory. Each entry is `{ path, bytes }`
 * with the leading `package/` (or other npm-pack prefix) preserved. Used by
 * the bundle resolver to walk a bundle's `bundle.json` + nested per-package
 * tarballs.
 */
export async function readTarEntries(
  tarball: Uint8Array,
): Promise<Array<{ path: string; bytes: Uint8Array }>> {
  if (tarball.byteLength > MAX_TARBALL_SIZE_BYTES) {
    throw new Error(
      `Tarball exceeds maximum size: ${tarball.byteLength} > ${MAX_TARBALL_SIZE_BYTES} bytes`,
    );
  }

  const entries: Array<{ path: string; bytes: Uint8Array }> = [];
  const Parser = await getTarParser();

  await new Promise<void>((resolve, reject) => {
    const parser = new Parser({
      strict: false,
      onReadEntry: (entry) => {
        if (entry.type !== "File" && entry.type !== "OldFile") {
          entry.resume();
          return;
        }
        const chunks: Buffer[] = [];
        entry.on("data", (chunk: Buffer) => chunks.push(chunk));
        entry.on("end", () => {
          entries.push({
            path: entry.path,
            bytes: new Uint8Array(Buffer.concat(chunks)),
          });
        });
        entry.on("error", reject);
      },
    });

    parser.on("end", resolve);
    parser.on("error", reject);

    Readable.from(Buffer.from(tarball)).pipe(parser);
  });

  return entries;
}

/**
 * Extract `package/package.json` from a single-package npm-style tarball
 * and validate it against `installPackageMetadataSchema`.
 */
export async function extractPackageJson(
  tarball: Uint8Array,
): Promise<InstallPackageMetadata> {
  const entries = await readTarEntries(tarball);

  const pkgEntry = entries.find(
    (e) => e.path === `${TAR_PREFIX}package.json`,
  );

  if (!pkgEntry) {
    throw new Error(
      `Tarball does not contain a 'package/package.json' entry. ` +
        `Make sure the tarball was produced by 'bun pm pack' or the ` +
        `@checkstack/scripts plugin-pack CLI.`,
    );
  }

  const text = new TextDecoder().decode(pkgEntry.bytes);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`Failed to parse package.json from tarball`, {
      cause: error,
    });
  }

  const result = installPackageMetadataSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `Tarball package.json failed validation: ${result.error.message}`,
    );
  }
  return result.data;
}

/**
 * If the tarball is a `--bundle`-mode outer tarball (contains `bundle.json`
 * at the root, plus nested `packages/*.tgz`), return the manifest + sibling
 * tarballs. Returns `undefined` for plain single-package tarballs.
 */
export async function tryExtractBundle(tarball: Uint8Array): Promise<
  | {
      manifest: PluginBundleManifest;
      siblings: Array<{ tarball: Uint8Array; packageJson: InstallPackageMetadata }>;
    }
  | undefined
> {
  const entries = await readTarEntries(tarball);
  const manifestEntry = entries.find((e) => e.path === "bundle.json");
  if (!manifestEntry) return undefined;

  const manifestText = new TextDecoder().decode(manifestEntry.bytes);
  let manifestParsed: unknown;
  try {
    manifestParsed = JSON.parse(manifestText);
  } catch (error) {
    throw new Error(`Failed to parse bundle.json`, { cause: error });
  }
  const manifestResult = pluginBundleManifestSchema.safeParse(manifestParsed);
  if (!manifestResult.success) {
    throw new Error(
      `bundle.json failed validation: ${manifestResult.error.message}`,
    );
  }

  const manifest = manifestResult.data;
  const siblings: Array<{
    tarball: Uint8Array;
    packageJson: InstallPackageMetadata;
  }> = [];

  for (const pkg of manifest.packages) {
    const entry = entries.find((e) => e.path === pkg.tarball);
    if (!entry) {
      throw new Error(
        `Bundle manifest references '${pkg.tarball}' but it's not present in the tarball`,
      );
    }
    const packageJson = await extractPackageJson(entry.bytes);
    if (packageJson.name !== pkg.name) {
      throw new Error(
        `Bundle manifest claims '${pkg.name}' for ${pkg.tarball} but tarball contains '${packageJson.name}'`,
      );
    }
    siblings.push({ tarball: entry.bytes, packageJson });
  }

  return { manifest, siblings };
}
