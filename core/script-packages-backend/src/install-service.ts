import type {
  ManifestEntry,
  PackageSpec,
} from "@checkstack/script-packages-common";
import { computeLockfileHash } from "./lockfile";
import { blobSha256 } from "./blob-hash";

/**
 * Orchestrates a single install: resolve the pinned allowlist into a
 * manifest, publish any new content-addressed blobs to the active blob
 * store, and return the manifest + lockfile hash + total size.
 *
 * The registry-facing parts (writing package.json/.npmrc, running
 * `bun install`, parsing the lockfile, archiving cache entries) are
 * injected as a {@link Resolver} so this orchestration is fully
 * unit-testable without a network or a Bun subprocess. The concrete
 * resolver lives alongside the reconciler (it shares the cache-archive
 * logic).
 */

export interface ResolvedPackage {
  entry: ManifestEntry;
  /** Compressed, content-addressed blob bytes for this package. */
  blob: Uint8Array;
}

export interface Resolver {
  /**
   * Run the registry-facing resolve+install for the enabled allowlist and
   * return the resolved packages (manifest entry + blob per package).
   */
  resolve(input: {
    packages: PackageSpec[];
    ignoreScripts: boolean;
  }): Promise<ResolvedPackage[]>;
}

/** Minimal blob-store surface the installer needs (publish-only). */
export interface BlobPublisher {
  has(input: { integrity: string }): Promise<boolean>;
  put(input: { integrity: string; bytes: Uint8Array }): Promise<void>;
  /** Active backend id, recorded in the blob index. */
  readonly id: string;
}

/** Records a published blob in the content-addressed index. */
export interface BlobIndex {
  record(input: {
    integrity: string;
    name: string;
    version: string;
    backend: string;
    sizeBytes: number;
  }): Promise<void>;
}

export interface InstallResult {
  lockfileHash: string;
  manifest: ManifestEntry[];
  totalSizeBytes: number;
  /** Integrities that were newly published (not already in the store). */
  publishedIntegrities: string[];
}

/**
 * Perform the resolve + publish step. Idempotent at the blob level: a blob
 * already present in the active store (and any other backend, per the
 * `has` check) is not re-published. Total size is the sum of resolved blob
 * sizes - the figure the size guardrail checks.
 */
export async function performInstall({
  packages,
  ignoreScripts,
  resolver,
  blobStore,
  blobIndex,
}: {
  packages: PackageSpec[];
  ignoreScripts: boolean;
  resolver: Resolver;
  blobStore: BlobPublisher;
  blobIndex: BlobIndex;
}): Promise<InstallResult> {
  const resolved = await resolver.resolve({ packages, ignoreScripts });

  const manifest: ManifestEntry[] = [];
  const publishedIntegrities: string[] = [];
  let totalSizeBytes = 0;

  for (const { entry, blob } of resolved) {
    // Stamp the distributed-blob hash so every host can verify the
    // transported bytes before extraction (the SRI `integrity` hashes the
    // npm tarball, not our archive).
    manifest.push({ ...entry, blobSha256: blobSha256(blob) });
    totalSizeBytes += blob.byteLength;

    if (!(await blobStore.has({ integrity: entry.integrity }))) {
      await blobStore.put({ integrity: entry.integrity, bytes: blob });
      await blobIndex.record({
        integrity: entry.integrity,
        name: entry.name,
        version: entry.version,
        backend: blobStore.id,
        sizeBytes: blob.byteLength,
      });
      publishedIntegrities.push(entry.integrity);
    }
  }

  return {
    lockfileHash: computeLockfileHash(manifest),
    manifest,
    totalSizeBytes,
    publishedIntegrities,
  };
}
