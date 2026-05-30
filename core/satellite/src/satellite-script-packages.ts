import {
  reconcileToHash,
  createReconcileFsDeps,
} from "@checkstack/script-packages-backend";
import { extractErrorMessage } from "@checkstack/common";

interface ManifestEntryWire {
  name: string;
  version: string;
  integrity: string;
}

export interface SatelliteScriptPackagesDeps {
  /** Package-store root on this satellite (`<dataDir>/script-packages`). */
  storeRoot: string;
  /** Fetch the manifest for a hash from core (over WS). */
  requestManifest(lockfileHash: string): Promise<ManifestEntryWire[]>;
  /** Fetch one blob (base64) from core (over WS); null if core lacks it. */
  requestBlob(integrity: string): Promise<string | null>;
  /** Report reconcile state back to core for the admin UI. */
  reportState(state: {
    lockfileHash: string | null;
    status: "pending" | "syncing" | "ready" | "error";
    errorMessage?: string;
  }): void;
  logger?: {
    info: (msg: string) => void;
    error: (msg: string) => void;
    debug: (msg: string) => void;
  };
}

/**
 * Drives script-package reconciliation on a satellite, reusing the Phase 2
 * reconciler (`reconcileToHash` + `createReconcileFsDeps`) over the WS
 * transport: blobs are pulled from CORE, never the registry.
 *
 * Serialized: only one reconcile runs at a time; a request arriving during a
 * reconcile is coalesced to the latest desired hash. Tracks readiness so the
 * runner path can degrade clearly when packages aren't synced.
 */
export class SatelliteScriptPackages {
  private readonly deps: SatelliteScriptPackagesDeps;
  private running = false;
  private pendingHash: string | null | undefined;
  // `undefined` = never reconciled yet (distinct from a desired `null` =
  // "no packages"), so the first reconcile to null still runs + reports.
  private readyHash: string | null | undefined;
  private lastError: string | undefined;

  constructor(deps: SatelliteScriptPackagesDeps) {
    this.deps = deps;
  }

  /** The lockfile hash this satellite has successfully materialized, if any. */
  get currentReadyHash(): string | null {
    return this.readyHash ?? null;
  }

  /**
   * Request convergence to `lockfileHash` (null = no packages). Coalesces
   * concurrent requests to the latest desired hash.
   */
  async reconcile(lockfileHash: string | null): Promise<void> {
    this.pendingHash = lockfileHash;
    if (this.running) return;
    this.running = true;
    try {
      // Drain coalesced requests: keep going until pending matches what we
      // last reconciled.
      for (;;) {
        const target = this.pendingHash;
        if (target === undefined || target === this.readyHash) break;
        this.pendingHash = undefined;
        await this.reconcileOnce(target);
      }
    } finally {
      this.running = false;
    }
  }

  private async reconcileOnce(lockfileHash: string | null): Promise<void> {
    if (lockfileHash === null) {
      // No packages desired - mark ready with no tree.
      this.readyHash = null;
      this.lastError = undefined;
      this.deps.reportState({ lockfileHash: null, status: "ready" });
      return;
    }

    this.deps.reportState({ lockfileHash, status: "syncing" });
    try {
      const manifest = await this.deps.requestManifest(lockfileHash);
      const reconcileDeps = createReconcileFsDeps({
        storeRoot: this.deps.storeRoot,
        logger: this.deps.logger
          ? {
              debug: this.deps.logger.debug,
              error: this.deps.logger.error,
            }
          : undefined,
        fetchBlob: async ({ integrity }) => {
          const base64 = await this.deps.requestBlob(integrity);
          if (base64 === null) {
            throw new Error(
              `Core did not return blob ${integrity}; cannot reconcile.`,
            );
          }
          return new Uint8Array(Buffer.from(base64, "base64"));
        },
      });

      await reconcileToHash({ lockfileHash, manifest, deps: reconcileDeps });
      this.readyHash = lockfileHash;
      this.lastError = undefined;
      this.deps.reportState({ lockfileHash, status: "ready" });
      this.deps.logger?.info(`Script packages reconciled to ${lockfileHash}.`);
    } catch (error) {
      this.lastError = extractErrorMessage(error);
      this.deps.reportState({
        lockfileHash,
        status: "error",
        errorMessage: this.lastError,
      });
      this.deps.logger?.error(
        `Script-package reconcile to ${lockfileHash} failed: ${this.lastError}`,
      );
    }
  }
}
