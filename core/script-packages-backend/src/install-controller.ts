import { extractErrorMessage } from "@checkstack/common";
import type {
  ManifestEntry,
  PackageSpec,
  SizeCapConfig,
} from "@checkstack/script-packages-common";
import {
  performInstall,
  type BlobIndex,
  type BlobPublisher,
  type Resolver,
} from "./install-service";
import type { InstallStateStore, InstallerLock } from "./install-state-store";
import { evaluateSizeCap } from "./size-cap";

/**
 * Coordinates one `installNow`: installer election (advisory lock), resolve
 * + publish, size-cap enforcement, install-state persistence, and emitting
 * `script-packages.changed`. Refuses to run while a storage migration is in
 * flight.
 *
 * All collaborators are injected so the orchestration is unit-testable
 * without a DB, a registry, or a real blob store.
 */

export interface InstallControllerDeps {
  installState: InstallStateStore;
  installerLock: InstallerLock;
  resolver: Resolver;
  blobStore: BlobPublisher;
  blobIndex: BlobIndex;
  /** Enabled allowlist + registry ignore-scripts flag at install time. */
  loadInstallInputs(): Promise<{
    packages: PackageSpec[];
    ignoreScripts: boolean;
  }>;
  sizeCap(): Promise<SizeCapConfig>;
  /** True while a storage migration is in flight (blocks installs). */
  isMigrationInFlight(): Promise<boolean>;
  /** Emit `script-packages.changed { lockfileHash }` after a successful install. */
  emitChanged(input: { lockfileHash: string }): Promise<void>;
  /**
   * Record the just-installed manifest in lockfile history so the blob GC can
   * compute its retained set (current + previous N). Best-effort: a failure
   * here must not fail the install, but it must not silently throw either.
   */
  recordHistory?(input: {
    lockfileHash: string;
    manifest: ManifestEntry[];
  }): Promise<void>;
  logger?: { debug(msg: string): void; error(msg: string): void };
}

export interface InstallOutcome {
  started: boolean;
  reason?: string;
}

/**
 * Run an install if eligible. Returns `{ started: false, reason }` when
 * refused (migration in flight, another installer holds the lock, or the
 * resolved size exceeds the block threshold). The advisory lock is always
 * released.
 */
export async function runInstallNow(
  deps: InstallControllerDeps,
): Promise<InstallOutcome> {
  if (await deps.isMigrationInFlight()) {
    return {
      started: false,
      reason: "A storage migration is in progress; try again once it completes.",
    };
  }

  const lock = await deps.installerLock.tryInstallerLock();
  if (!lock) {
    return {
      started: false,
      reason: "Another instance is currently installing.",
    };
  }

  try {
    await deps.installState.setInstalling();

    const { packages, ignoreScripts } = await deps.loadInstallInputs();
    const result = await performInstall({
      packages,
      ignoreScripts,
      resolver: deps.resolver,
      blobStore: deps.blobStore,
      blobIndex: deps.blobIndex,
    });

    const cap = await deps.sizeCap();
    const verdict = evaluateSizeCap({
      totalSizeBytes: result.totalSizeBytes,
      cap,
    });
    if (verdict.level === "block") {
      await deps.installState.setError(verdict.message);
      return { started: false, reason: verdict.message };
    }

    await deps.installState.setReady({
      lockfileHash: result.lockfileHash,
      manifest: result.manifest,
      totalSizeBytes: result.totalSizeBytes,
    });
    // Record the manifest in lockfile history so the blob GC's retained set
    // (current + previous N) is computable. Best-effort: a history failure
    // must not fail an otherwise-successful install.
    try {
      await deps.recordHistory?.({
        lockfileHash: result.lockfileHash,
        manifest: result.manifest,
      });
    } catch (error) {
      deps.logger?.error(
        `Failed to record lockfile history for ${result.lockfileHash}: ${extractErrorMessage(error)}`,
      );
    }
    await deps.emitChanged({ lockfileHash: result.lockfileHash });

    deps.logger?.debug(
      `Script packages installed: ${result.manifest.length} package(s), lockfile ${result.lockfileHash}.`,
    );
    return { started: true };
  } catch (error) {
    const message = extractErrorMessage(error);
    await deps.installState.setError(message);
    deps.logger?.error(`Script package install failed: ${message}`);
    return { started: false, reason: message };
  } finally {
    await lock.release();
  }
}
