import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { defaultEsmScriptRunner } from "@checkstack/backend-api";
import { performInstall, type BlobIndex } from "./install-service";
import { createCentralResolver } from "./resolver";
import { reconcileToHash } from "./reconciler";
import { createReconcileFsDeps } from "./reconcile-fs";
import { storePaths } from "./data-dir";

/**
 * End-to-end proof of the central-store + core-reconciliation pipeline
 * against a real (tiny, pure-JS) package:
 *
 *   resolve+install -> publish per-package blobs -> reconcile (delta pull
 *   from the "blob store") -> bun install --offline materialize -> atomic
 *   `current` flip -> a user script imports the package via resolutionRoot.
 *
 * Network is only touched once (the central resolve); the reconcile side
 * pulls from the in-memory blob store, never the registry.
 */
// This test reaches the public npm registry once (the central resolve), so
// it's opt-in to avoid flakiness / failures in offline CI. Run with
// `CHECKSTACK_E2E_NETWORK=1 bun test` to exercise the full pipeline.
const E2E_ENABLED = process.env.CHECKSTACK_E2E_NETWORK === "1";

describe.skipIf(!E2E_ENABLED)("e2e: install + reconcile + import", () => {
  let work: string;
  // In-memory blob store standing in for the active BlobStore.
  const blobs = new Map<string, Uint8Array>();

  beforeAll(async () => {
    work = await mkdtemp(path.join(tmpdir(), "cs-e2e-"));
  });
  afterAll(async () => {
    await rm(work, { recursive: true, force: true });
  });

  test(
    "resolves leftpad centrally, reconciles on a fresh host, and runs an import",
    async () => {
      const resolver = createCentralResolver({
        scratchDir: path.join(work, "install-scratch"),
        cacheDir: path.join(work, "install-cache"),
        registry: {
          registryUrl: "https://registry.npmjs.org/",
          scopedRegistries: [],
        },
      });

      const index: BlobIndex = { record: async () => {} };
      const blobStore = {
        id: "memory",
        has: async ({ integrity }: { integrity: string }) =>
          blobs.has(integrity),
        put: async ({
          integrity,
          bytes,
        }: {
          integrity: string;
          bytes: Uint8Array;
        }) => {
          blobs.set(integrity, bytes);
        },
      };

      const installResult = await performInstall({
        packages: [{ name: "leftpad", version: "0.0.1", enabled: true }],
        ignoreScripts: true,
        resolver,
        blobStore,
        blobIndex: index,
      });

      expect(installResult.manifest.length).toBeGreaterThanOrEqual(1);
      expect(installResult.lockfileHash.length).toBe(64);
      expect(blobs.size).toBeGreaterThanOrEqual(1);

      // ── Fresh host reconcile (cold cache, pulls all blobs from the store) ──
      const storeRoot = path.join(work, "host-store");
      const deps = createReconcileFsDeps({
        storeRoot,
        fetchBlob: async ({ integrity }) => {
          const bytes = blobs.get(integrity);
          if (!bytes) throw new Error(`blob ${integrity} not in store`);
          return bytes;
        },
      });

      const recRes = await reconcileToHash({
        lockfileHash: installResult.lockfileHash,
        manifest: installResult.manifest,
        deps,
      });
      expect(recRes.alreadyConverged).toBe(false);
      expect(recRes.pulledIntegrities.length).toBe(blobs.size);

      // A second reconcile is a no-op (idempotent convergence).
      const again = await reconcileToHash({
        lockfileHash: installResult.lockfileHash,
        manifest: installResult.manifest,
        deps,
      });
      expect(again.alreadyConverged).toBe(true);

      // ── Run a user script that imports the materialized package ──
      const current = storePaths(storeRoot).current;
      const run = await defaultEsmScriptRunner.run({
        script: `import leftpad from "leftpad";\nexport default leftpad("7", 3);`,
        context: {},
        timeoutMs: 20_000,
        resolutionRoot: current,
      });
      expect(run.error).toBeUndefined();
      // leftpad pads with "0" by default.
      expect(run.result).toBe("007");
    },
    60_000,
  );
});
