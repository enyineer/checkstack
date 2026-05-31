import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  performInstall,
  createCentralResolver,
  reconcileToHash,
  createReconcileFsDeps,
  resolveResolutionRootFromStore,
  blobSha256,
  type BlobIndex,
} from "@checkstack/script-packages-backend";
import type { ManifestEntry } from "@checkstack/script-packages-common";
import { createScriptRunAction, type ScriptRunConfig } from "./automations";
import { LEFTPAD_CACHE_BLOB_BASE64 } from "./run-script-packages-fixture";

const noopLogger = {
  debug: () => {},
  error: () => {},
  info: () => {},
  warn: () => {},
};

/** Minimal execution context for exercising the action's `execute` directly. */
function execCtx(config: ScriptRunConfig) {
  return {
    config,
    logger: noopLogger,
    runId: "run-1",
    automationId: "auto-1",
    contextKey: null,
    consumedArtifacts: {},
    getService: async () => {
      throw new Error("getService not available in test");
    },
  } as unknown as Parameters<
    ReturnType<typeof createScriptRunAction>["execute"]
  >[0];
}

/**
 * THE proof that Feature 1 actually works end-to-end through the REAL
 * action execute path (not just a runner unit test):
 *
 *   resolve+install leftpad -> publish blobs -> reconcile (materialize the
 *   tree into <store>/current) -> a `run_script` action whose
 *   getResolutionRoot points at that store -> the user script
 *   `import leftpad from "leftpad"` succeeds via `execute()`.
 *
 * Network is touched once (the central resolve), so it's opt-in:
 * `CHECKSTACK_E2E_NETWORK=1 bun test`.
 */
const E2E_ENABLED = process.env.CHECKSTACK_E2E_NETWORK === "1";

/**
 * HERMETIC (network-free) variant of the headline import e2e — runs in CI by
 * default. Instead of resolving against the live npm registry, it feeds the
 * REAL reconcile path a vendored content-addressed blob (a gzip-tar of a real
 * `leftpad@0.0.1` Bun cache entry — see `run-script-packages-fixture.ts`),
 * exactly the shape the central resolver publishes. The blob is seeded +
 * verified (`blobSha256`) through `createReconcileFsDeps`, materialized into
 * `<store>/current` by the real `materializeAndFlip` (`bun install --offline`,
 * zero network), then imported through the REAL `run_script` action's
 * `execute()` via `resolveResolutionRootFromStore`.
 *
 * This is the executing CI guard for the resolve/reconcile/resolutionRoot/
 * runner seam: a regression there turns this suite red without needing
 * `CHECKSTACK_E2E_NETWORK`.
 */
describe("run_script + npm packages (hermetic, real action path)", () => {
  let work: string;

  beforeAll(async () => {
    work = await mkdtemp(path.join(tmpdir(), "cs-action-hermetic-"));
  });
  afterAll(async () => {
    await rm(work, { recursive: true, force: true });
  });

  test(
    "imports a vendored package through execute() with no network",
    async () => {
      const blob = Uint8Array.from(
        Buffer.from(LEFTPAD_CACHE_BLOB_BASE64, "base64"),
      );

      // A manifest entry as the resolver would emit one. `integrity` is the
      // content-addressed key (used as the fetch key + cache marker, not
      // re-validated against the cache entry); `blobSha256` IS verified
      // before extraction, so it must match the vendored bytes.
      const integrity = "sha512-leftpad-0.0.1-hermetic-fixture-key";
      const manifest: ManifestEntry[] = [
        {
          name: "leftpad",
          version: "0.0.1",
          integrity,
          blobSha256: blobSha256(blob),
        },
      ];
      // lockfileHash is derived the same way the installer derives it, but the
      // reconcile path only needs it as the tree dir name + convergence key.
      const lockfileHash =
        "hermetic0000000000000000000000000000000000000000000000000000fixt";

      const storeRoot = path.join(work, "store");
      const reconciled = await reconcileToHash({
        lockfileHash,
        manifest,
        deps: createReconcileFsDeps({
          storeRoot,
          fetchBlob: async ({ integrity: want }) => {
            if (want !== integrity) throw new Error(`missing blob ${want}`);
            return blob;
          },
        }),
      });
      expect(reconciled.alreadyConverged).toBe(false);
      expect(reconciled.pulledIntegrities).toEqual([integrity]);

      // The REAL action, wired exactly like the plugin wires it.
      const action = createScriptRunAction({
        getResolutionRoot: () => resolveResolutionRootFromStore(storeRoot),
      });

      const result = await action.execute(
        execCtx({
          script: `import leftpad from "leftpad";\nexport default { id: leftpad("7", 3) };`,
          timeout: 20_000,
        }),
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.artifact?.result).toEqual({ id: "007" });
      }
    },
    60_000,
  );
});

describe.skipIf(!E2E_ENABLED)("run_script + npm packages (real action path)", () => {
  let work: string;
  const blobs = new Map<string, Uint8Array>();

  beforeAll(async () => {
    work = await mkdtemp(path.join(tmpdir(), "cs-action-e2e-"));
  });
  afterAll(async () => {
    await rm(work, { recursive: true, force: true });
  });

  test(
    "an allowlisted package imports successfully through execute()",
    async () => {
      // 1. Resolve + publish (central).
      const resolver = createCentralResolver({
        scratchDir: path.join(work, "scratch"),
        cacheDir: path.join(work, "cache"),
        registry: {
          registryUrl: "https://registry.npmjs.org/",
          scopedRegistries: [],
        },
      });
      const index: BlobIndex = { record: async () => {} };
      const blobStore = {
        id: "memory",
        has: async ({ integrity }: { integrity: string }) => blobs.has(integrity),
        put: async ({ integrity, bytes }: { integrity: string; bytes: Uint8Array }) => {
          blobs.set(integrity, bytes);
        },
      };
      const install = await performInstall({
        packages: [{ name: "leftpad", version: "0.0.1", enabled: true }],
        ignoreScripts: true,
        resolver,
        blobStore,
        blobIndex: index,
      });

      // 2. Reconcile into a host store (materializes <store>/current).
      const storeRoot = path.join(work, "store");
      await reconcileToHash({
        lockfileHash: install.lockfileHash,
        manifest: install.manifest,
        deps: createReconcileFsDeps({
          storeRoot,
          fetchBlob: async ({ integrity }) => {
            const bytes = blobs.get(integrity);
            if (!bytes) throw new Error(`missing blob ${integrity}`);
            return bytes;
          },
        }),
      });

      // 3. The REAL action, wired exactly like the plugin wires it.
      const action = createScriptRunAction({
        getResolutionRoot: () => resolveResolutionRootFromStore(storeRoot),
      });

      const result = await action.execute(
        execCtx({
          script: `import leftpad from "leftpad";\nexport default { id: leftpad("7", 3) };`,
          timeout: 20_000,
        }),
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.artifact?.result).toEqual({ id: "007" });
      }
    },
    60_000,
  );
});

describe("run_script degradation (no network)", () => {
  test("fails with a clear error when packages are configured but not synced", async () => {
    const action = createScriptRunAction({
      // notReady status -> the action should refuse to run.
      getResolutionRoot: async () => ({
        mode: "notReady",
        reason: "npm packages not ready on this central backend",
      }),
    });
    const result = await action.execute(
      execCtx({ script: `export default { id: "x" };`, timeout: 5_000 }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("not ready");
    }
  });

  test("runs normally (no resolution root) when no packages are configured", async () => {
    const action = createScriptRunAction({
      getResolutionRoot: async () => ({ mode: "none" }),
    });
    const result = await action.execute(
      execCtx({ script: `export default { id: "plain" };`, timeout: 10_000 }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.artifact?.result).toEqual({ id: "plain" });
    }
  });
});
